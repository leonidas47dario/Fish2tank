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
