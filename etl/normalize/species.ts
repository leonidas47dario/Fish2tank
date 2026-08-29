/**
 * Resolve a store listing title to a catalog species.
 *
 * 886 of the 1,868 listings carry a scientific name in parentheses, e.g.
 * "Black Kumpay Goby (Stiphodon atropurpureus)". That is the high-precision
 * path and is tried first.
 *
 * THE FAILURE MODE THIS GUARDS AGAINST. Naive substring matching on common
 * names is actively dangerous here. "Bass" is an alias of Largemouth Bass, and
 * "Peacock Bass" is an entirely different fish (Cichla, not Micropterus) that
 * is not in the catalog. A substring match would file peacock bass listings
 * under largemouth bass and quietly corrupt both medians.
 *
 * So a single-word common name only matches when the title is essentially just
 * that word. Multi-word names match as a whole phrase on word boundaries.
 * Anything else stays unresolved - the same rule the inventory importer
 * follows (FR-O05), for the same reason.
 */
import type { Species } from '@/domain/types';

export type MatchMethod =
  | 'scientific-name'
  | 'product-type'
  | 'common-name'
  | 'alias'
  | 'derived-binomial';

export interface SpeciesMatch {
  speciesId?: string;
  method?: MatchMethod;
  /** Scientific name found in the title, whether or not it matched the catalog. */
  scientificNameInTitle?: string;
}

/**
 * Binomial (or trinomial) inside parentheses: "(Stiphodon atropurpureus)".
 * Requires the capitalised-genus / lowercase-species shape, so it does not
 * fire on "( Male )" or "(Grade A)".
 */
const SCIENTIFIC_IN_PARENS = /\(\s*([A-Z][a-z]{2,})\s+([a-z]{2,})(?:\s+([a-z]{2,}))?\s*\)/;

/**
 * Open-nomenclature qualifiers, not species epithets. "Cichlasoma sp." means
 * "some Cichlasoma we have not identified" - treating `sp` as an epithet
 * invented a species called "Cichlasoma sp" that 57 listings then pooled into.
 */
const NOT_AN_EPITHET = new Set(['sp', 'spp', 'cf', 'aff', 'var', 'nov', 'indet']);

/**
 * English determiners a vendor uses to label a catch-all bucket. Never a genus.
 *
 * Imperial Tropicals files its odds and ends under product_type "Other
 * catfish" and "Other loricariids", which have the exact Capitalised-word
 * lowercase-word shape of a binomial. Before this guard those minted two
 * species that 246 listings pooled into - one of them holding eight
 * unrelated fish under the name "Catfish", which is the ambiguous-generic
 * failure the catalog quality gate exists to catch.
 *
 * 'other' is the one observed in the wild; the rest are the same construction
 * and are listed so the next vendor bucket does not have to break the build
 * first.
 */
const NOT_A_GENUS = new Set([
  'other', 'assorted', 'misc', 'miscellaneous', 'mixed', 'various', 'unknown', 'unsorted',
]);

export function extractScientificName(title: string): string | undefined {
  const m = SCIENTIFIC_IN_PARENS.exec(title);
  if (!m) return undefined;
  const [, genus, epithet, sub] = m;
  if (!genus || NOT_A_GENUS.has(genus.toLowerCase())) return undefined;
  if (!epithet || NOT_AN_EPITHET.has(epithet)) return undefined;
  const parts = [genus, epithet];
  // A trailing qualifier ("Pterophyllum scalare sp") is dropped, not kept.
  if (sub && !NOT_AN_EPITHET.has(sub)) parts.push(sub);
  return parts.join(' ');
}

/**
 * A bare binomial in Shopify's `product_type` field.
 *
 * WHY THIS PATH EXISTS. The parenthesised-binomial rule above assumes the
 * vendor writes "Candy Cane Coral (Caulastrea furcata)". LiveAquaria does not:
 * across 250 sampled products, ZERO titles carry a binomial in parentheses,
 * and the scientific name is in `product_type` instead, bare and unbracketed.
 * Without this the store would contribute 3,000 listings and resolve none.
 *
 * The field is structured metadata rather than marketing copy, so it is a
 * cleaner signal than the title - but it is also frequently a bare genus
 * ("Sarcophyton sp.") or empty, both of which must resolve to nothing rather
 * than mint a fake species. Same NOT_AN_EPITHET guard as the title path.
 */
const BINOMIAL_BARE = /^([A-Z][a-z]{2,})\s+([a-z]{2,})(?:\s+([a-z]{2,}))?\.?$/;

export function extractProductTypeBinomial(productType: string | undefined): string | undefined {
  const m = productType?.trim().match(BINOMIAL_BARE);
  if (!m) return undefined;
  const [, genus, epithet, sub] = m;
  if (!genus || NOT_A_GENUS.has(genus.toLowerCase())) return undefined;
  if (!epithet || NOT_AN_EPITHET.has(epithet)) return undefined;
  const parts = [genus, epithet];
  if (sub && !NOT_AN_EPITHET.has(sub)) parts.push(sub);
  return parts.join(' ');
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')          // drop parenthesised asides
    .replace(/#\w+/g, ' ')             // drop stock codes like "#M1"
    .replace(/[^a-z0-9\s]/g, ' ')      // punctuation to space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-phrase, word-boundary containment. Not substring. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const words = haystack.split(' ');
  const target = phrase.split(' ');
  for (let i = 0; i + target.length <= words.length; i += 1) {
    if (target.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * Grading and quality words stores put around a name. Stripped before the
 * "is the title essentially just this name" test, so "Premium Betta" still
 * resolves while "Peacock Bass" still does not.
 */
const DECORATORS = new Set([
  'hq', 'premium', 'grade', 'a', 'aa', 'aaa', 'super', 'high', 'quality',
  'live', 'fish', 'juvenile', 'juvie', 'adult', 'young', 'male', 'female',
  'unsexed', 'pair', 'rare', 'imported', 'wild', 'caught', 'tank', 'raised',
  'the', 'and', 'with', 'for', 'sale', 'new', 'sold', 'out',
]);

function contentWords(title: string): string[] {
  return normalize(title).split(' ').filter((w) => w && !DECORATORS.has(w) && !/^\d+$/.test(w));
}

export interface MatcherOptions {
  /**
   * A single-word name must account for the whole title (after decorators are
   * stripped) to count. Multi-word names are specific enough to match inside a
   * longer title.
   */
  minWordsForPhraseMatch?: number;
}

export function buildMatcher(catalog: Species[], options: MatcherOptions = {}) {
  const minWords = options.minWordsForPhraseMatch ?? 2;

  const byScientific = new Map<string, string>();
  for (const s of catalog) {
    if (s.scientificName) byScientific.set(s.scientificName.toLowerCase(), s.id);
  }

  // Longest names first: "Electric Blue Acara" must win over "Acara".
  const names: Array<{ id: string; name: string; words: number; method: MatchMethod }> = [];
  for (const s of catalog) {
    names.push({ id: s.id, name: normalize(s.commonName), words: normalize(s.commonName).split(' ').length, method: 'common-name' });
    for (const a of s.aliases) {
      names.push({ id: s.id, name: normalize(a), words: normalize(a).split(' ').length, method: 'alias' });
    }
  }
  names.sort((a, b) => b.name.length - a.name.length);

  return function match(title: string, productType?: string): SpeciesMatch {
    const scientificNameInTitle = extractScientificName(title);

    if (scientificNameInTitle) {
      const hit = byScientific.get(scientificNameInTitle.toLowerCase());
      if (hit) return { speciesId: hit, method: 'scientific-name', scientificNameInTitle };
      // A scientific name we do not stock is still worth reporting, but it must
      // not fall through to a loose common-name match: the title has already
      // told us precisely what it is, and it is not in the catalog.
      return { scientificNameInTitle };
    }

    // The vendor stated the binomial in structured metadata instead of the
    // title. Same precision as the title path, so it gets the same precedence
    // over common-name guessing, and the same refusal to fall through.
    const fromType = extractProductTypeBinomial(productType);
    if (fromType) {
      const hit = byScientific.get(fromType.toLowerCase());
      if (hit) return { speciesId: hit, method: 'product-type', scientificNameInTitle: fromType };
      return { scientificNameInTitle: fromType };
    }

    const normalized = normalize(title);
    const content = contentWords(title);

    for (const cand of names) {
      if (!cand.name) continue;
      if (cand.words >= minWords) {
        if (containsPhrase(normalized, cand.name)) {
          return { speciesId: cand.id, method: cand.method, scientificNameInTitle };
        }
      } else {
        // Single word: the title must be essentially just this name.
        if (content.length === 1 && content[0] === cand.name) {
          return { speciesId: cand.id, method: cand.method, scientificNameInTitle };
        }
      }
    }

    return { scientificNameInTitle };
  };
}
