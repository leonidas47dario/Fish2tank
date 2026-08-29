/**
 * The on-disk shape of data/market/images.jsonl, in one place.
 *
 * It was inline in build-images.ts (writer) and build-portraits.ts (reader),
 * which is two definitions of one contract. Adding `provenance` to both by
 * hand is exactly how they drift.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Provenance, SpeciesImage } from './sources/wikimedia';
// From surrogate-key.ts, NOT build-warehouse.ts: that module calls main() at
// import time, which is the bug an earlier task fixed. Do not reintroduce it.
import { surrogateKey } from './surrogate-key';

export const IMAGES_PATH = 'data/market/images.jsonl';

export interface ImageRow {
  image_key: string;
  species_id: string;
  role: string;
  source: string;
  provenance: Provenance;
  url: string;
  license: string | null;
  artist: string | null;
  attribution_url: string | null;
  width: number | null;
  height: number | null;
  retrieved_at: string;
}

export function toRow(image: SpeciesImage): ImageRow {
  return {
    image_key: surrogateKey(image.url).toString(),
    species_id: image.speciesId,
    role: image.role,
    source: image.source,
    provenance: image.provenance,
    url: image.url,
    license: image.license ?? null,
    artist: image.artist ?? null,
    attribution_url: image.attributionUrl ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    retrieved_at: image.retrievedAt,
  };
}

export function readRows(path = IMAGES_PATH): ImageRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as ImageRow)
    // Rows written before spec 002 have no provenance. They are all Wikimedia
    // by construction, since that was the only route that existed.
    .map((r) => ({ ...r, provenance: r.provenance ?? 'wikimedia' }));
}

export function writeRows(rows: ImageRow[], path = IMAGES_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/**
 * Formats `build-portraits.ts` can actually turn into a bundled JPEG.
 *
 * It downscales through Chromium's `Image.decode()`, which handles what a
 * browser handles and nothing else. TIFF is the one that bites: Commons serves
 * plenty of it, the row looks perfectly healthy, and the failure only surfaces
 * at bundle time as a generic decode error.
 *
 * This is not hypothetical. It is the exact reason the committed data had 700
 * image rows but only 695 bundled portraits: five rows are `.tif`, four of
 * them 19th-century Iconographia Zoologica lithographs. Worse than the missing
 * picture is that those five species each HELD a row, so the gap-fill counted
 * them as covered and never retried them by any other route. A dead-end that
 * reports itself as done is the failure mode this pipeline is meant to avoid.
 *
 * An allowlist rather than a denylist of known-bad, so a new exotic format
 * fails closed and gets retried, instead of silently failing at bundle time.
 */
const BUNDLEABLE = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Whether an image URL can survive the downscale into the bundle.
 *
 * Checked at the point a resolver's candidate is ACCEPTED, not only when
 * deciding which species to attempt. Skipping the acceptance check makes the
 * retry a loop: the five .tif species were re-attempted, the article route
 * handed back the identical .tif lead image, and the run reported five
 * resolutions that changed nothing. Rejecting the format at acceptance lets
 * the next route down have a go instead.
 */
export function isBundleableUrl(url: string): boolean {
  return BUNDLEABLE.test(url.split('?')[0]!);
}

/** Whether this row's image can survive the downscale into the bundle. */
export function isBundleable(row: ImageRow): boolean {
  return isBundleableUrl(row.url);
}

/**
 * Existing rows plus new ones, newest winning per species.
 *
 * `keep` drops rows whose species has left the catalog. Passing it is optional
 * because a gap-fill run that cannot read the catalog should not silently
 * delete history.
 */
export function mergeRows(existing: ImageRow[], fresh: ImageRow[], keep?: Set<string>): ImageRow[] {
  const by = new Map<string, ImageRow>();
  for (const r of existing) by.set(r.species_id, r);
  for (const r of fresh) by.set(r.species_id, r);
  const out = [...by.values()];
  return keep ? out.filter((r) => keep.has(r.species_id)) : out;
}
