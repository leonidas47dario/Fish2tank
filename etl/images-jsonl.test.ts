import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { isBundleable, mergeRows, readRows, toRow, writeRows, type ImageRow } from './images-jsonl';

const row = (species_id: string, url: string): ImageRow => ({
  image_key: '1', species_id, role: 'portrait', source: 'wikimedia',
  provenance: 'wikimedia', url, license: 'CC0', artist: null,
  attribution_url: 'https://commons.wikimedia.org/wiki/File:x.jpg',
  width: 800, height: 600, retrieved_at: '2026-08-29T00:00:00.000Z',
});

describe('toRow', () => {
  it('flattens a SpeciesImage into the jsonl shape, nulling absent fields', () => {
    const out = toRow({
      speciesId: 'sp_x', role: 'portrait', source: 'imperialtropicals.com',
      provenance: 'vendor', url: 'https://cdn.shopify.com/a.jpg',
      artist: 'Imperial Tropicals', attributionUrl: 'https://imperialtropicals.com/products/x',
      retrievedAt: '2026-08-29T00:00:00.000Z',
    });
    expect(out.license).toBeNull();
    expect(out.width).toBeNull();
    expect(out.provenance).toBe('vendor');
    expect(out.image_key).toMatch(/^\d+$/);
  });
});

describe('mergeRows', () => {
  it('keeps existing rows and appends new species', () => {
    const merged = mergeRows([row('sp_a', 'https://x/a.jpg')], [row('sp_b', 'https://x/b.jpg')]);
    expect(merged.map((r) => r.species_id)).toEqual(['sp_a', 'sp_b']);
  });

  it('lets a new row replace an existing one for the same species', () => {
    // Re-running after a manual fix must not leave the old row behind, or
    // build-marts picks the widest of the two and the fix does nothing.
    const merged = mergeRows([row('sp_a', 'https://x/old.jpg')], [row('sp_a', 'https://x/new.jpg')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.url).toBe('https://x/new.jpg');
  });

  it('drops rows for species no longer in the catalog when given a keep-set', () => {
    const merged = mergeRows(
      [row('sp_a', 'https://x/a.jpg'), row('sp_gone', 'https://x/g.jpg')],
      [],
      new Set(['sp_a']),
    );
    expect(merged.map((r) => r.species_id)).toEqual(['sp_a']);
  });
});

describe('readRows / writeRows round trip', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reproduces a file byte for byte when every row already has provenance', () => {
    dir = mkdtempSync(join(tmpdir(), 'images-jsonl-'));
    const path = join(dir, 'images.jsonl');
    const rows = [row('sp_a', 'https://x/a.jpg'), row('sp_b', 'https://x/b.jpg')];

    writeRows(rows, path);
    const original = readFileSync(path, 'utf8');

    const readBack = readRows(path);
    writeRows(readBack, path);
    const rewritten = readFileSync(path, 'utf8');

    expect(rewritten).toBe(original);
  });
});

describe('isBundleable', () => {
  it('accepts the formats Chromium can decode', () => {
    for (const url of [
      'https://x/a.jpg', 'https://x/a.JPEG', 'https://x/a.png',
      'https://x/a.gif', 'https://x/a.webp',
      'https://cdn.shopify.com/s/files/1/x/fish.jpg?v=1690466794',
    ]) {
      expect(isBundleable(row('sp_a', url))).toBe(true);
    }
  });

  it('rejects TIFF, which is why 5 of the 700 committed rows never bundled', () => {
    // Not hypothetical. Four Iconographia Zoologica lithographs and one other
    // .tif sat in images.jsonl looking healthy, failed silently at downscale
    // time, and blocked their species from being retried by any other route.
    // That is exactly the 700 rows versus 695 bundled files discrepancy.
    expect(isBundleable(row('sp_a', 'https://upload.wikimedia.org/x/Gymnothorax.tif'))).toBe(false);
  });

  it('rejects an unknown format rather than assuming it will decode', () => {
    // Allowlist, not denylist: a format nobody thought about should fail
    // closed and get retried, not fail at bundle time.
    expect(isBundleable(row('sp_a', 'https://x/a.svg'))).toBe(false);
    expect(isBundleable(row('sp_a', 'https://x/a.pdf'))).toBe(false);
    expect(isBundleable(row('sp_a', 'https://x/no-extension'))).toBe(false);
  });
});
