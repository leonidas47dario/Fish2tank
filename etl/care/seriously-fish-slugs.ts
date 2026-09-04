/**
 * Matching our catalog to Seriously Fish's slugs - spec 045.
 *
 * PURE, and separate from the fetcher, because the fetcher runs its `main()`
 * on import: the matching rules have to be testable without starting a crawl.
 */
import { join } from 'node:path';
import { TEXT_DIR } from './paths';

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
  /** `epithet` is a CANDIDATE the page itself still has to confirm. */
  how: 'exact' | 'epithet';
}

export function matchSlugs(
  rows: Array<{ speciesId: string; scientificName?: string }>,
  slugs: string[],
): { matches: SlugMatch[]; ambiguous: number; absent: number } {
  const set = new Set(slugs);

  /*
   * Epithet index, for the genus reshuffles taxonomy keeps handing us -
   * Corydoras split into Hoplisoma and Osteogaster, so our binomial and SF's
   * disagree on the genus while naming the same fish. Only a UNIQUE epithet is
   * usable: two fish sharing one epithet in different genera is exactly the
   * case where a guess lands on the wrong animal.
   */
  const byEpithet = new Map<string, string[]>();
  for (const s of slugs) {
    const epithet = s.split('-')[1];
    if (!epithet) continue;
    const list = byEpithet.get(epithet) ?? [];
    list.push(s);
    byEpithet.set(epithet, list);
  }

  const matches: SlugMatch[] = [];
  let ambiguous = 0; let absent = 0;

  for (const row of rows) {
    const full = sfSlugFor(row.scientificName);
    const binomial = full.split('-').slice(0, 2).join('-');
    const exact = set.has(full) ? full : set.has(binomial) ? binomial : undefined;
    if (exact) {
      matches.push({ speciesId: row.speciesId, scientificName: row.scientificName ?? '', slug: exact, how: 'exact' });
      continue;
    }
    const epithet = full.split('-')[1];
    const hits = epithet ? byEpithet.get(epithet) : undefined;
    if (hits?.length === 1) {
      matches.push({ speciesId: row.speciesId, scientificName: row.scientificName ?? '', slug: hits[0]!, how: 'epithet' });
    } else if (hits && hits.length > 1) ambiguous += 1;
    else absent += 1;
  }

  return { matches, ambiguous, absent };
}
