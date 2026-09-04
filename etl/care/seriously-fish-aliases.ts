/**
 * Curated Seriously Fish correspondences - spec 060.
 *
 * WHY A TABLE AND NOT A RULE. Spec 060 removed the unique-epithet fallback,
 * which was wrong 94% of the time because it tested whether an epithet was
 * unique in SF's slug set rather than whether the fish was ours. What replaces
 * it is an exact trinomial rule plus this file: the cases a rule cannot reach
 * are single facts a person checked, and that is what a curated table is for.
 *
 * Every entry cites a source, following the rule `species-overrides.ts` already
 * sets for curated data: "an uncited correction is a guess wearing a lab coat".
 * `seriously-fish-aliases.test.ts` asserts it rather than leaving it to review.
 *
 * iNATURALIST WAS EVALUATED AS AN AUTOMATIC SOURCE FOR THIS AND REJECTED. In a
 * 60-species sample it mapped `Trichogaster lalia` (dwarf gourami) onto
 * `Trichogaster fasciata` (banded gourami), because "lalia" is not the accepted
 * spelling and its fuzzy search returned a congener. One wrong animal in three
 * hits is the same failure this file exists to stop importing.
 */

export interface SfAlias {
  /** Our catalog's binomial. */
  binomial: string;
  /** The Seriously Fish slug that is the same fish. */
  slug: string;
  /** Why these are one animal. Required - see the header. */
  source: string;
}

/**
 * Our binomial -> the SF slug for the same fish.
 *
 * For genus moves and outright typos on SF's side, which no slug rule can
 * reach because neither half of the name matches.
 */
export const SF_SLUG_ALIASES: readonly SfAlias[] = [
  {
    binomial: 'Axelrodia riesei',
    slug: 'axelrodi-riesei',
    source: "SF's own slug drops the final 'a' from the genus; the page states "
      + '"Axelrodia riesei". Reached before spec 060 only by the epithet fallback.',
  },
  {
    binomial: 'Darienheros calobrensis',
    slug: 'amphilophus-calobrensis',
    source: 'Darienheros was erected for this species out of Amphilophus '
      + '(Rícan et al. 2016); SF files it under the older genus.',
  },
  {
    binomial: 'Dekeyseria picta',
    slug: 'dekeyseria-brachyura',
    source: 'D. brachyura is carried as an alias of D. picta in our own catalog '
      + 'row; same genus, senior synonym.',
  },
  {
    binomial: 'Synodontis multipunctatus',
    slug: 'synodontis-multipunctata',
    source: 'Gender-agreement spelling of the same epithet, and carried as an '
      + 'alias on our own catalog row.',
  },
  {
    binomial: 'Pao palembangensis',
    slug: 'tetraodon-palembangensis',
    source: 'Moved from Tetraodon to Pao (Kottelat 2013); SF files it under the '
      + 'older genus, and our catalog row carries the old name as an alias.',
  },
];

/**
 * Pairs of names that are the same fish, for the wrong-animal guard.
 *
 * DIFFERENT FROM THE TABLE ABOVE. These are cases where the slug matched
 * EXACTLY and the page then stated a different accepted name - so nothing is
 * wrong with the match, only with the guard's assumption that a page naming a
 * different binomial must be a redirect to a different animal.
 *
 * Kept as small as the evidence allows. Two of spec 056's four exact-slug
 * rejections are NOT here and should not be: Aphyosemion bivittatum and
 * A. bitaeniatum are different species, and SF folding Neolamprologus brichardi
 * into N. pulcher is contested rather than settled.
 */
export const SF_SAME_FISH: readonly SfAlias[] = [
  {
    binomial: 'Danio rerio',
    slug: 'Brachydanio rerio',
    source: 'Brachydanio is the original genus for the zebra danio and is '
      + 'still used by SF; universally treated as the same fish.',
  },
  {
    binomial: 'Puntius tambraparniei',
    slug: 'Dawkinsia tambraparniei',
    source: 'Moved into Dawkinsia by Pethiyagoda et al. (2012); SF uses the '
      + 'current genus and our catalog row the older one.',
  },
];

const norm = (s: string) => s.trim().toLowerCase();

/** The curated SF slug for a binomial, if one is on record. */
export const SLUG_BY_BINOMIAL: ReadonlyMap<string, string> = new Map(
  SF_SLUG_ALIASES.map((a) => [norm(a.binomial), a.slug]),
);

/**
 * Every pair these tables assert to be one fish.
 *
 * A SLUG ALIAS IMPLIES AN EQUIVALENCE, and keeping the two as separate
 * hand-maintained lists was a mistake caught by running the ingest: all three
 * alias entries found the right page and were then rejected by the guard,
 * because the page states the name the slug is built from and the alias table
 * alone never told the guard those were the same animal. Two lists that must
 * agree will eventually not, so the second is derived from the first rather
 * than written twice.
 *
 * `dekeyseria-brachyura` -> `dekeyseria brachyura` is exact: the slug IS the
 * binomial SF files the fish under, which is what made the alias necessary.
 */
const EQUIVALENCES: ReadonlyArray<readonly [string, string]> = [
  ...SF_SLUG_ALIASES.map((a) => [norm(a.binomial), a.slug.replace(/-/g, ' ')] as const),
  ...SF_SAME_FISH.map((a) => [norm(a.binomial), norm(a.slug)] as const),
];

/** Whether two binomials are curated as naming one fish, in either direction. */
export function sameFish(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const [x, y] = [norm(a), norm(b)];
  if (x === y) return true;
  return EQUIVALENCES.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
}
