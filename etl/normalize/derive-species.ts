/**
 * Minting species from what the vendors actually sell.
 *
 * THE FLAW THIS FIXES. The species dimension was built from a hand-written
 * catalog of 47, and listings were matched TO it. That is backwards: the
 * vendors name 1,068 distinct binomials, so 96% of the library was invisible.
 * The dimension should be derived from the listings, with the curated care
 * profiles as an enrichment layer on top of it.
 *
 * A derived species carries NO care data - no adult size, no minimum tank, no
 * aggression. That is honest and load-bearing: the compatibility engine will
 * return "Not enough data" for it, which is correct, rather than screening a
 * fish nobody has profiled.
 */

/** Stable, readable id from a binomial. Same input always yields the same id. */
export function derivedSpeciesId(scientificName: string): string {
  const slug = scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `sp_${slug}`;
}

/** Words that are grading, colour or trade decoration rather than the fish. */
const DECORATION = new Set([
  'albino', 'golden', 'gold', 'red', 'blue', 'green', 'black', 'white', 'yellow',
  'orange', 'pink', 'purple', 'silver', 'platinum', 'super', 'premium', 'hq',
  'grade', 'a', 'aa', 'aaa', 'assorted', 'mixed', 'select', 'jumbo', 'mini',
  'short', 'body', 'long', 'fin', 'longfin', 'shortfin', 'balloon', 'ballon',
  'koi', 'marble', 'leucistic', 'melanistic', 'gfp', 'live', 'juvenile',
  'male', 'female', 'unsexed', 'pair', 'young', 'adult', 'rare', 'new',
  'b', 'c', 'the', 'and', 'with', 'x', 'combo', 'pack', 'lot', 'group',
]);

/**
 * A display name for a species we only know from trade titles.
 *
 * The titles for one binomial vary wildly - "Red Devil koi Angelfish",
 * "Black Angelfish", "Koi Angelfish" all being Pterophyllum scalare - so no
 * single title can be the species name. The shared TAIL of those titles is
 * what they have in common, and it is almost always the real common name:
 * "Angelfish", "Tiger Oscar", "Peacock Bass".
 *
 * Returns undefined when the titles share nothing meaningful, in which case
 * the caller should fall back to the scientific name rather than pick one
 * vendor's marketing.
 */
export function deriveCommonName(titles: string[]): string | undefined {
  if (titles.length === 0) return undefined;

  const tokenised = titles
    .map((t) =>
      t
        .replace(/\(.*?\)/g, ' ')      // drop the binomial itself
        .replace(/#\w+/g, ' ')         // stock codes
        .replace(/[^A-Za-z\s-]/g, ' ') // punctuation and sizes
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    )
    .filter((t) => t.length > 0);
  if (tokenised.length === 0) return undefined;

  /**
   * Coverage dominates, length only breaks ties.
   *
   * Ranking by length first was wrong: for four angelfish titles, "Koi
   * Angelfish" covers two of them and "Angelfish" covers all four, and taking
   * the longest suffix that cleared a threshold picked the former. The name
   * shared by the MOST listings is the species name; a longer suffix only
   * wins when it is shared just as widely ("Peacock Bass" over "Bass").
   */
  const MIN_COVERAGE = 0.6;
  let best: { name: string; coverage: number; len: number } | undefined;

  for (let len = 1; len <= 3; len += 1) {
    const counts = new Map<string, number>();
    for (const words of tokenised) {
      if (words.length < len) continue;
      const tail = words.slice(-len);
      // A suffix made only of decoration is a morph, not a name.
      if (tail.every((w) => DECORATION.has(w.toLowerCase()))) continue;
      const key = tail.join(' ').toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [name, n] of counts) {
      const coverage = n / tokenised.length;
      if (coverage < MIN_COVERAGE) continue;
      // With several titles, a suffix seen only once is not shared at all.
      if (tokenised.length > 1 && n < 2) continue;
      if (!best || coverage > best.coverage || (coverage === best.coverage && len > best.len)) {
        best = { name, coverage, len };
      }
    }
  }

  return best ? titleCase(best.name) : undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export interface DiscoveredSpecies {
  speciesId: string;
  scientificName: string;
  commonName: string;
  /** Distinct trade names seen, most frequent first. Useful for search. */
  aliases: string[];
  listings: number;
}

/**
 * Build the discovered half of the species dimension from listing rows.
 *
 * `curated` is the set of scientific names that already have a hand-written
 * profile; those are skipped so the curated entry stays authoritative.
 */
export function discoverSpecies(
  listings: Array<{ scientificNameInTitle?: string; title: string }>,
  curated: Set<string>,
): DiscoveredSpecies[] {
  const byBinomial = new Map<string, string[]>();
  for (const l of listings) {
    const sci = l.scientificNameInTitle;
    if (!sci) continue;
    if (curated.has(sci.toLowerCase())) continue;
    const bucket = byBinomial.get(sci) ?? [];
    bucket.push(l.title);
    byBinomial.set(sci, bucket);
  }

  return [...byBinomial.entries()]
    .map(([scientificName, titles]) => {
      const counts = new Map<string, number>();
      for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
      return {
        speciesId: derivedSpeciesId(scientificName),
        scientificName,
        commonName: deriveCommonName(titles) ?? scientificName,
        aliases: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t),
        listings: titles.length,
      };
    })
    .sort((a, b) => b.listings - a.listings);
}
