import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from '../db';
import { blobKeyLadder } from './renditions';
import { readMediaBlob } from './read';

/**
 * Spec 036. The rule worth guarding is not "pick the smaller key" - that is
 * one line and obvious. It is that a rung can be MISSING FROM STORAGE while
 * present in the row, which is the normal state of a device part-way through
 * its first sync, and a reader that trusted the row would draw nothing there.
 */

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();
});

const KEYS = {
  originalBlobKey: 'blob_original',
  previewBlobKey: 'blob_preview',
  thumbnailBlobKey: 'blob_thumb',
};

/** Distinct bytes per key, so a test can tell WHICH rung it was handed. */
async function store(key: string, marker: number) {
  await db.blobs.add({
    key,
    data: new Uint8Array([marker]).buffer,
    bytes: 1,
    mimeType: 'image/jpeg',
    storedAt: '2026-09-01T00:00:00.000Z',
  });
}

const MARKER = { blob_thumb: 1, blob_preview: 2, blob_original: 3 } as const;

async function which(blob: Blob | undefined) {
  if (!blob) return 'nothing';
  const [marker] = new Uint8Array(await blob.arrayBuffer());
  return Object.entries(MARKER).find(([, m]) => m === marker)?.[0] ?? 'unknown';
}

describe('blobKeyLadder', () => {
  it('puts the thumbnail first, then falls back through preview to original', () => {
    expect(blobKeyLadder(KEYS, 'thumbnail'))
      .toEqual(['blob_thumb', 'blob_preview', 'blob_original']);
  });

  it('never offers a thumbnail to a caller drawing at preview size', () => {
    // A 320px image stretched across a full-width hero is worse than the wait.
    expect(blobKeyLadder(KEYS, 'preview')).toEqual(['blob_preview', 'blob_original']);
  });

  it('skips rungs a photo never had', () => {
    // The normal case for anything under 1280px, and for every photo taken
    // before spec 029 - there is no backfill.
    const plain = { originalBlobKey: 'blob_original' };

    expect(blobKeyLadder(plain, 'thumbnail')).toEqual(['blob_original']);
    expect(blobKeyLadder(plain, 'preview')).toEqual(['blob_original']);
  });
});

describe('readMediaBlob', () => {
  it('reads the thumbnail for a small box when it is there', async () => {
    for (const key of Object.keys(MARKER)) await store(key, MARKER[key as keyof typeof MARKER]);

    expect(await which(await readMediaBlob(KEYS, 'thumbnail', db))).toBe('blob_thumb');
    expect(await which(await readMediaBlob(KEYS, 'preview', db))).toBe('blob_preview');
  });

  it('FALLS BACK WHEN THE ROW NAMES A BLOB THAT HAS NOT SYNCED YET', async () => {
    // The bug this function exists to prevent. The media row arrived with all
    // three keys; the media queue is still working through the blobs and only
    // the original has landed. Resolving the key and stopping would show an
    // empty tile on the second device - exactly where the thumbnail-first
    // ordering (FR-A03) was supposed to help most.
    await store('blob_original', MARKER.blob_original);

    expect(await which(await readMediaBlob(KEYS, 'thumbnail', db))).toBe('blob_original');
    expect(await which(await readMediaBlob(KEYS, 'preview', db))).toBe('blob_original');
  });

  it('takes the preview when only the thumbnail is missing', async () => {
    await store('blob_preview', MARKER.blob_preview);
    await store('blob_original', MARKER.blob_original);

    expect(await which(await readMediaBlob(KEYS, 'thumbnail', db))).toBe('blob_preview');
  });

  it('shows SOMETHING as soon as any size exists, even the smallest', async () => {
    // The other direction of the same sync race: thumbnails go first, so this
    // is what a fresh device sees for a while. A soft picture beats no picture.
    await store('blob_thumb', MARKER.blob_thumb);

    expect(await which(await readMediaBlob(KEYS, 'thumbnail', db))).toBe('blob_thumb');
    // Nothing on the preview ladder has arrived - and a thumbnail is NOT
    // silently substituted into a hero. `undefined` is the honest answer.
    expect(await which(await readMediaBlob(KEYS, 'preview', db))).toBe('nothing');
  });

  it('returns nothing when no size of the photo is on this device', async () => {
    expect(await readMediaBlob(KEYS, 'thumbnail', db)).toBeUndefined();
  });
});
