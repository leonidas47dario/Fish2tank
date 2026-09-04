/**
 * Which portraits ship inside the bundle, and which are fetched when looked at.
 *
 * Spec 059. `import.meta.glob` is eager and Workbox precaches every emitted
 * `.jpg`, so before this every device downloaded every portrait before the app
 * worked offline - measured at 984 files, 20.8 MB, 98.7% of the precache
 * entries. Spec 058 then took coverage from 989 species to 2,027, which would
 * have made that roughly 46 MB.
 *
 * THE SPLIT HAS TO BE BY DIRECTORY. Workbox builds its manifest from the built
 * output, where a bundled asset's filename is a content hash, so there is no
 * way to say "precache these two hundred" from a config file. Two directories
 * is the only selector both halves can agree on.
 */
import type { ImageRow } from './images-jsonl';

/** Bundled and precached. Everything else is fetched on first view. */
export const CORE_DIR = 'src/data/seed/assets/portraits';

/**
 * Copied verbatim into the site, so the URL is stable and predictable enough
 * for `portraitAsset` to build without a manifest.
 */
export const TAIL_DIR = 'public/portraits';

/**
 * How many portraits ride along in the install.
 *
 * 200 at the measured mean of 21.6 KB is 4.2 MB, taking the precache from
 * 25.1 MB to roughly 8.6 MB. Chosen so a fresh install offline still looks
 * like a catalog rather than a grid of silhouettes - precaching none was
 * rejected for exactly that reason.
 */
export const CORE_PORTRAITS = 200;

/** Total listings per species, from the market mart. Missing means zero. */
export type ListingCounts = Map<string, number>;

/**
 * The core set, most-listed first.
 *
 * Market listings are the same ordering `build-images.ts` already uses to
 * decide which species to attempt first, so the two steps agree on what
 * "likely to be looked at" means rather than each inventing it.
 *
 * Ties break on species id so a rebuild is deterministic: without it two runs
 * over the same data could disagree about which portrait is bundled, and the
 * diff would look like a real change.
 */
export function coreSpecies(
  rows: ImageRow[],
  listings: ListingCounts,
  limit = CORE_PORTRAITS,
): Set<string> {
  const ranked = [...new Set(rows.map((r) => r.species_id))].sort((a, b) =>
    (listings.get(b) ?? 0) - (listings.get(a) ?? 0) || a.localeCompare(b));
  return new Set(ranked.slice(0, limit));
}

/** Where a species' portrait file belongs. */
export function tierFor(speciesId: string, core: Set<string>): 'core' | 'tail' {
  return core.has(speciesId) ? 'core' : 'tail';
}
