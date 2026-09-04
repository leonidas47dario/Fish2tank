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
  source: 'wikipedia' | 'vendor' | 'seriouslyfish';
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

  /*
   * Spec 045. Seriously Fish carries four things nothing else we read does.
   *
   * `lengthBasis` is not decoration: `adultSizeIn` has meant nose-to-tail-tip
   * for some species and nose-to-tail-base for others, with no way to tell
   * which, and a compatibility engine mixing the two is quietly wrong for
   * every deep-bodied fish.
   */
  lengthBasis?: 'SL' | 'TL' | 'unstated';
  ph?: CareValue<{ min: number; max: number }>;
  hardnessDgh?: CareValue<{ min: number; max: number }>;
  /** The footprint, which a volume alone does not give: a 14-gal tall is not 24x12. */
  tankBaseIn?: CareValue<{ length: number; width: number }>;
  /**
   * SF's own six-measure rating. Attributed, never quote-gated - it is an
   * editorial judgement with no sentence behind it, and dressing it as a
   * sourced figure is the one thing the gate exists to prevent.
   */
  difficulty?: { source: string; sourceUrl?: string; measures: Array<{ measure: string; word: string }> };
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
