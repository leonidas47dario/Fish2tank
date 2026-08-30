/**
 * The boundary between "a keeper typed this" and "this ships to everyone".
 *
 * Pure, so every rule is testable without an export file or a network. The
 * reading and writing live in `etl/review-user-species.ts`; this decides what
 * to do with a submission.
 *
 * WHAT THESE RULES CAN AND CANNOT DO. They catch the mechanical failures - a
 * blank name, a submission that is already in the catalog under another
 * spelling, a name that is a size or a price rather than a fish. They cannot
 * catch a confident misreading of a store tag, and nothing here should pretend
 * otherwise: `review` is the verdict for anything a person should look at, and
 * the CLI never accepts on its own.
 */

/** A species row out of a keeper's export, as the CLI reads it. */
export interface Submission {
  id: string;
  commonName: string;
  scientificName?: string;
  aliases?: string[];
  createdAt: string;
  submission?: { label: string; specimenId?: string; submittedAt: string; note?: string };
  /** How many of the keeper's specimens carry this species. */
  specimenCount: number;
}

/** The shipped catalog, reduced to what matching needs. */
export interface CatalogEntry {
  speciesId: string;
  commonName: string;
  scientificName?: string;
  aliases: string[];
}

export type Verdict =
  | { verdict: 'accept' }
  | { verdict: 'review'; reason: string; matches?: CatalogEntry[] }
  | { verdict: 'reject'; reason: string };

/** A name shorter than this is not a species, it is a slip of the thumb. */
const MIN_NAME_CHARS = 3;

/**
 * Normalise for comparison only - never for storage.
 *
 * Case, punctuation and doubled spaces are noise when deciding whether two
 * people named the same fish. The keeper's exact wording is what gets stored;
 * this is only ever used to line two strings up beside each other.
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'an', 'fish', 'live', 'tank', 'aquarium', 'sp', 'spp', 'cf']);

function tokens(s: string): string[] {
  return normalise(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Catalog entries that might already be this fish.
 *
 * Exact match on any name first, then a token-overlap pass that catches
 * "congo tetra" against "Congo Tetra (Phenacogrammus interruptus)". Ordered
 * best-first so the reviewer reads the likeliest duplicate at the top.
 */
export function findCatalogMatches(sub: Submission, catalog: CatalogEntry[]): CatalogEntry[] {
  const name = normalise(sub.commonName);
  const sci = sub.scientificName ? normalise(sub.scientificName) : '';
  const subTokens = new Set(tokens(sub.commonName));

  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of catalog) {
    const names = [entry.commonName, entry.scientificName ?? '', ...entry.aliases]
      .filter(Boolean)
      .map(normalise);

    if (names.includes(name) || (sci && names.includes(sci))) {
      scored.push({ entry, score: 1000 });
      continue;
    }
    if (subTokens.size === 0) continue;

    // Best token overlap across any of this entry's names.
    let best = 0;
    for (const n of names) {
      const nt = new Set(tokens(n));
      if (nt.size === 0) continue;
      let hit = 0;
      for (const t of subTokens) if (nt.has(t)) hit++;
      // Fraction of the SUBMISSION's words the entry accounts for. Keyed this
      // way round so a long catalog name does not dilute a short submission.
      best = Math.max(best, hit / subTokens.size);
    }
    if (best >= 0.5) scored.push({ entry, score: best });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.entry);
}

/** Names that are plainly not a species, whatever else is true. */
function looksLikeJunk(name: string): string | undefined {
  const n = normalise(name);
  if (!n) return 'the name is blank once punctuation is removed';
  if (n.replace(/\s/g, '').length < MIN_NAME_CHARS) {
    return `"${name}" is shorter than ${MIN_NAME_CHARS} characters`;
  }
  if (/^\d+(\s|$)/.test(n) || /^[\d\s.]+$/.test(n)) {
    return `"${name}" reads as a number or a size, not a name`;
  }
  if (/^(unknown|unidentified|test|asdf|fish|n\/?a|tbd|\?+)$/.test(n)) {
    return `"${name}" is a placeholder, not a species`;
  }
  return undefined;
}

/**
 * What to do with one submission.
 *
 * Note what is deliberately NOT a rejection: a submission with only one
 * specimen behind it. A keeper who has caught exactly one of a fish the
 * catalog is missing is the whole reason this pipeline exists, and requiring
 * a second sighting would filter out precisely the rarest entries. It is a
 * `review` signal in the CLI's output instead, where a person can weigh it.
 */
export function checkSubmission(sub: Submission, catalog: CatalogEntry[]): Verdict {
  const junk = looksLikeJunk(sub.commonName);
  if (junk) return { verdict: 'reject', reason: junk };

  const matches = findCatalogMatches(sub, catalog);
  if (matches.length > 0) {
    const exact = normalise(matches[0]!.commonName) === normalise(sub.commonName);
    return {
      verdict: 'review',
      reason: exact
        ? `the catalog already has "${matches[0]!.commonName}" under this exact name`
        : `may already be in the catalog as "${matches[0]!.commonName}"`,
      matches,
    };
  }

  return { verdict: 'accept' };
}
