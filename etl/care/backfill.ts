/**
 * The verified care backfill, as the mart builder consumes it.
 *
 * WHY THIS IS APPLIED AT MART LEVEL AND NOT IN THE WAREHOUSE. The same reason
 * `species-overrides.ts` is: the warehouse is rebuilt from a vendor scrape, and
 * anything merged into it has to be re-derived on every refresh or it is lost.
 * `build-marts.ts` applies this after reading the warehouse, so a verified
 * value survives every future rebuild of dim_species without being re-scraped.
 *
 * It is also the honest place for it. dim_species records what the vendors and
 * the curated catalog assert. This layer records what a document said, and
 * keeps a link to the document.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { AggressionRating } from '@/domain/types';

const DEFAULT_PATH = 'src/data/seed/species-care.json';

export interface CareValue<T> {
  value: T;
  quote: string;
  source: 'wikipedia' | 'vendor';
  sourceUrl?: string;
}

export interface CareRecord {
  speciesId: string;
  adultSizeIn?: CareValue<number>;
  minVolumeGal?: CareValue<number>;
  /**
   * Narrowed to the domain union rather than `string`: the ingest gate rejects
   * anything outside the four ratings, so by the time a value is in this file
   * it is one of them.
   */
  aggression?: CareValue<AggressionRating>;
  tempC?: CareValue<{ min: number; max: number }>;
}

/**
 * Absent file is a normal state, not an error - the catalog must build on a
 * clean checkout before the backfill has ever been run. It logs the fact
 * rather than failing silently, because "0 species enriched" and "the file was
 * not there" are different problems and only one of them is a bug.
 */
export function loadCareBackfill(path = DEFAULT_PATH): Map<string, CareRecord> {
  if (!existsSync(path)) {
    console.log(`  care backfill    none at ${path} (building without it)`);
    return new Map();
  }
  const { species } = JSON.parse(readFileSync(path, 'utf8')) as { species: CareRecord[] };
  return new Map(species.map((s) => [s.speciesId, s]));
}
