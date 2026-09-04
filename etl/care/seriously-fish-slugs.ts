/**
 * Matching our catalog to Seriously Fish's slugs - spec 045.
 *
 * PURE, and separate from the fetcher, because the fetcher runs its `main()`
 * on import: the matching rules have to be testable without starting a crawl.
 */
import { join } from 'node:path';
import { TEXT_DIR } from './paths';
import { SLUG_BY_BINOMIAL } from './seriously-fish-aliases';

export const SF_BASE = 'https://www.seriouslyfish.com';

export const sfTextPath = (speciesId: string) => join(TEXT_DIR, `${speciesId}.seriouslyfish.txt`);

/** `Trigonostigma heteromorpha` -> `trigonostigma-heteromorpha`. */
export function sfSlugFor(scientificName: string | undefined): string {
  return (scientificName ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, '-');
}

export interface SlugMatch {
  speciesId: string;
  scientificName: string;
  slug: string;
  /**
   * How the slug was arrived at. All three are exact on the parts that
   * identify the animal - spec 060 removed the one that was not.
   *
   * `trinomial` is SF filing a species under its nominate subspecies
   * (`polypterus-endlicheri-endlicheri`); GENUS AND EPITHET BOTH have to match,
   * so unlike the epithet fallback it cannot cross to another animal.
   * `curated` is a human-checked correspondence with a cited source.
   */
  how: 'exact' | 'trinomial' | 'curated';
}

export function matchSlugs(
  rows: Array<{ speciesId: string; scientificName?: string }>,
  slugs: string[],
): { matches: SlugMatch[]; absent: number } {
  const set = new Set(slugs);

  /*
   * SPEC 060 REMOVED AN EPITHET INDEX FROM HERE, and the reason is worth
   * keeping so nobody rebuilds it.
   *
   * It matched our binomial to any SF slug sharing its epithet, provided that
   * epithet was UNIQUE among SF's slugs. Its own comment warned about the risk
   * and then tested the wrong thing: uniqueness in the target set is not
   * evidence of identity. Measured against the real run, it proposed 79
   * candidates and 74 were a different animal - 94% - including Esox niger, a
   * pickerel, onto Oxydoras niger, a catfish, and Carassius auratus, a
   * goldfish, onto Melanochromis auratus, a cichlid. Nothing shipped wrong,
   * because the ingest's binomial guard caught every one, but a matcher that
   * is mostly wrong and safe only because something downstream checks it is
   * one loosened guard away from the failure P6 exists to prevent.
   *
   * What replaced it: the trinomial index below, which requires the genus to
   * match too, and a curated table for the rest.
   */
  const byBinomial = new Map<string, string>();
  for (const s of slugs) {
    const parts = s.split('-');
    if (parts.length !== 3) continue;
    const key = `${parts[0]}-${parts[1]}`;
    if (!byBinomial.has(key)) byBinomial.set(key, s);
  }

  const matches: SlugMatch[] = [];
  let absent = 0;

  for (const row of rows) {
    const full = sfSlugFor(row.scientificName);
    const binomial = full.split('-').slice(0, 2).join('-');
    const name = row.scientificName ?? '';
    const hit = (slug: string, how: SlugMatch['how']) =>
      matches.push({ speciesId: row.speciesId, scientificName: name, slug, how });

    const exact = set.has(full) ? full : set.has(binomial) ? binomial : undefined;
    if (exact) { hit(exact, 'exact'); continue; }

    // Human-checked correspondences win over any rule: they exist precisely
    // because no rule reaches them.
    const curated = SLUG_BY_BINOMIAL.get(name.trim().toLowerCase());
    if (curated && set.has(curated)) { hit(curated, 'curated'); continue; }

    const tri = byBinomial.get(binomial);
    if (tri) { hit(tri, 'trinomial'); continue; }

    absent += 1;
  }

  return { matches, absent };
}
