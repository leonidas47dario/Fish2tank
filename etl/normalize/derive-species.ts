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

import { isUsableName } from '@/data/seed/catalog-quality';
import { CANONICAL_BY_SYNONYM } from '@/data/seed/species-overrides';

/** Stable, readable id from a binomial. Same input always yields the same id. */
export function derivedSpeciesId(scientificName: string): string {
  const slug = scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `sp_${slug}`;
}

/**
 * Fold a species minted from a misspelled binomial onto the record the catalog
 * actually keeps.
 *
 * WHY THIS IS APPLIED AT MINT TIME rather than in the index. build-marts.ts
 * drops non-canonical records from the catalog, but the market index is built
 * by an earlier, separate stage that never knew about the drop. So the prices
 * stayed attached to ids the catalog no longer shows: 43 of the 65 Green
 * Swordtail listings were discarded outright, and the shipped Discus median
 * came from the minority spelling, $95 against the $59.99 that 13 listings
 * under `aequifasciata` actually supported.
 *
 * Folding here fixes every consumer at once - the JSONL, the CSV, the fact
 * table and the index all carry the canonical id - and leaves the drop in
 * build-marts.ts as a safety net rather than the only line of defence.
 *
 * `scientificNameInTitle` is deliberately left as the vendor wrote it, so the
 * fold is auditable from the listing rather than being lost in it.
 */
export function canonicalSpeciesId(speciesId: string): string {
  return CANONICAL_BY_SYNONYM.get(speciesId) ?? speciesId;
}

/**
 * Packaging and husbandry words that trail a title but never end a name.
 *
 * Kept separate from DECORATION on purpose. DECORATION holds colour and morph
 * words ("koi", "albino") which are stripped only when they make up the WHOLE
 * candidate - "Butterfly Koi" must survive, because koi is the fish. These are
 * different: nothing is ever called a "Pairs" or a "Culture", so they can be
 * peeled off the end of a title unconditionally.
 */
const TRAILING_NOISE = new Set([
  'pairs', 'pair', 'pack', 'packs', 'lot', 'lots', 'group', 'groups',
  'culture', 'cultures', 'portion', 'portions', 'bunch', 'bunched', 'bunches',
  'each', 'set', 'sets', 'pcs', 'piece', 'pieces', 'qty', 'count',
  'tbsp', 'cup', 'bag', 'box', 'combo', 'special', 'sale', 'new',
]);

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
 * The part of a listing title that can contain the fish's name.
 *
 * THE BUG THIS FIXES. Ranking shared SUFFIXES of the whole title produced 26%
 * of the catalog as garbage, because vendors append their boilerplate to the
 * end and every listing shares it:
 *
 *   "Red Robin Gourami (Trichogaster labiosa) - Tank Bred"
 *   "Sunset Thicklip Gourami (Trichogaster labiosa) - Tank Bred"
 *
 * The longest suffix shared by both is "- Tank Bred", so that became the
 * species name. Fourteen unrelated species ended up called "- tank bred".
 *
 * The structure the vendors actually use is
 * `<name> (<binomial>) <how it was raised, what size, who sells it>`. The name
 * is the HEAD, and everything from the binomial onward is decoration. So cut
 * there first and rank suffixes of the head - "Gourami" for the pair above,
 * which is right, and still "Angelfish" across four differently-coloured
 * angelfish, which is what the suffix ranking was always for.
 */
function titleHead(title: string): string[] {
  let head = title;

  // Everything from the binomial onward is vendor decoration.
  const paren = head.search(/\(\s*[A-Z][a-z]{2,}\s+[a-z]{2,}/);
  if (paren > 0) head = head.slice(0, paren);

  // "Samurai Gourami aka "Vaillant's Chocolate Gourami"" - the alias after
  // "aka" is a second name for the same fish, not part of the first one.
  head = head.split(/\s+(?:aka|a\.k\.a\.?|also known as)\s+/i)[0] ?? head;

  // A trailing clause made only of trade vocabulary, for the vendors who put
  // it after a dash with no binomial at all ("Koi Guppy Pairs- Locally Bred").
  head = head.replace(/[,\-–—]\s*[^,\-–—]*$/, (clause) => {
    const words = clause.replace(/[^A-Za-z\s]/g, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    const junk = words.every((w) => TRAILING_NOISE.has(w) || DECORATION.has(w) || BRED.has(w));
    return junk ? '' : clause;
  });

  const words = head
    .replace(/#\w+/g, ' ')         // stock codes
    .replace(/[^A-Za-z\s-]/g, ' ') // punctuation and sizes
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Peel packaging off the end: "Albino Koi Guppy Pairs" is a guppy.
  while (words.length > 1 && TRAILING_NOISE.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words;
}

/** How a fish was raised. Never part of its name, common in trailing clauses. */
const BRED = new Set([
  'tank', 'bred', 'raised', 'locally', 'captive', 'wild', 'caught',
  'aquacultured', 'imported', 'domestic', 'farm', 'farmed', 'bare', 'root',
  'w', 'lead', 'with', 'plant', 'plants', 'potted', 'loose',
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

  const tokenised = titles.map(titleHead).filter((t) => t.length > 0);
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

  if (!best) return undefined;

  // Last line of defence. Even with the head cut, a vendor can put its own
  // name where the fish's should be. The same rules the build gate applies to
  // the shipped catalog apply here, at the point the name is minted, so the
  // two can never disagree about what is acceptable.
  const name = titleCase(best.name);
  return isUsableName(name) ? name : undefined;
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

