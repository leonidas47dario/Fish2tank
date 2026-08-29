import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { mergeRows, readRows, toRow, writeRows, type ImageRow } from './images-jsonl';

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
