/**
 * Spec 064. What has to hold is narrow and the failure is expensive: a
 * photograph must never leave this device carrying the location it was taken
 * at, and the original must be exactly as the keeper left it (NFR-03).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { publishableKeyFor } from './publishable';
import type { Media } from '@/domain/types';

/**
 * JPEG-shaped bytes carrying an APP1/Exif segment, as a camera would produce.
 * An ArrayBuffer because that is what `StoredBlob.data` holds.
 */
function withExif(bytes = 4096): ArrayBuffer {
  const app1 = [0xFF, 0xE1, 0x00, 0x10, ...[...'Exif'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0];
  const out = new Uint8Array(2 + app1.length + bytes);
  out.set([0xFF, 0xD8, ...app1], 0);
  out.fill(0x42, 2 + app1.length);
  return out.buffer;
}

const textOf = (data: ArrayBuffer | undefined) =>
  new TextDecoder('latin1').decode(new Uint8Array(data!));

/**
 * A stand-in for the canvas. Node has no `createImageBitmap`, and the EXIF
 * property is a browser behaviour measured in Chromium (spec 064) rather than
 * here - what these tests assert is the DECISION around it.
 */
const fakeCanvas = {
  decode: async () => ({ width: 900, height: 600 }),
  encode: async () => new TextEncoder().encode('\xFF\xD8 clean pixels, no metadata').buffer,
  newKey: () => 'blob_stripped',
};

const media = (over: Partial<Media> = {}): Media => ({
  id: 'media_x', kind: 'photo', specimenIds: [], originalBlobKey: 'blob_orig',
  originalBytes: 4096, mimeType: 'image/jpeg',
  capturedAt: '2026-01-03T00:00:00.000Z', syncState: 'synced', ...over,
} as Media);

beforeEach(async () => {
  await db.media.clear();
  await db.blobs.clear();
});

describe('publishableKeyFor', () => {
  it('uses the existing preview untouched, because a canvas rendition has no metadata', async () => {
    const m = media({ previewBlobKey: 'blob_prev' });
    await db.media.add(m);
    expect(await publishableKeyFor(m, db)).toBe('blob_prev');
    // No second blob written: the cheap path must stay cheap.
    expect(await db.blobs.count()).toBe(0);
  });

  it('STRIPS a photo that has no preview, rather than publishing the original', async () => {
    /*
     * The whole point. `viewableBlobKey` used to return `blob_orig` here - the
     * keeper's file, byte for byte, GPS included - for any photo under
     * PREVIEW_EDGE, which is the population most likely to have arrived via a
     * messaging app with its metadata intact.
     */
    const m = media();
    await db.media.add(m);
    await db.blobs.add({
      key: 'blob_orig', data: withExif(), bytes: 4096,
      mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    const key = await publishableKeyFor(m, db, fakeCanvas);
    expect(key).toBeDefined();
    expect(key).not.toBe('blob_orig');

    const stripped = await db.blobs.get(key!);
    expect(textOf(stripped!.data)).not.toContain('Exif');
  });

  it('LEAVES THE ORIGINAL EXACTLY AS IT WAS - NFR-03 is not bent for NFR-04', async () => {
    const m = media();
    await db.media.add(m);
    await db.blobs.add({
      key: 'blob_orig', data: withExif(), bytes: 4096,
      mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    await publishableKeyFor(m, db);

    const after = await db.blobs.get('blob_orig');
    expect(textOf(after!.data)).toContain('Exif');
    expect(after!.bytes).toBe(4096);
  });

  it('remembers the stripped copy as the preview, so a second publish is free', async () => {
    const m = media();
    await db.media.add(m);
    await db.blobs.add({
      key: 'blob_orig', data: withExif(), bytes: 4096,
      mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    const first = await publishableKeyFor(m, db, fakeCanvas);
    expect((await db.media.get('media_x'))?.previewBlobKey).toBe(first);

    const reread = (await db.media.get('media_x'))!;
    const second = await publishableKeyFor(reread, db, fakeCanvas);
    expect(second).toBe(first);
    expect(await db.blobs.count()).toBe(2);   // original + the one strip
  });

  it('REFUSES to publish when the original has not synced to this device', async () => {
    // Not an error - a fresh device mid-sync is a real state. But there is
    // nothing here to strip, so there is nothing safe to publish.
    const m = media();
    await db.media.add(m);
    expect(await publishableKeyFor(m, db)).toBeUndefined();
  });

  it('REFUSES to publish when the bytes cannot be decoded, rather than failing open', async () => {
    /*
     * deriveRenditions keeps the photograph when a decode fails, which is right
     * for storage. Here the same choice would publish the exact bytes we were
     * trying to clean, so this one fails closed.
     */
    const m = media();
    await db.media.add(m);
    await db.blobs.add({
      key: 'blob_orig', data: new TextEncoder().encode('not an image').buffer,
      bytes: 12, mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Injected rather than relying on Node having no `createImageBitmap`: a
    // test that passes because a global is missing would pass just as happily
    // if this code failed OPEN, which is the one thing it must not do.
    expect(await publishableKeyFor(m, db, {
      ...fakeCanvas,
      decode: async () => { throw new Error('not an image'); },
    })).toBeUndefined();
    expect((await db.media.get('media_x'))?.previewBlobKey).toBeUndefined();
    warn.mockRestore();
  });

  it('REFUSES to publish when the re-encode fails, for the same reason', async () => {
    const m = media();
    await db.media.add(m);
    await db.blobs.add({
      key: 'blob_orig', data: withExif(), bytes: 4096,
      mimeType: 'image/jpeg', storedAt: '2026-01-03T00:00:00.000Z',
    } as never);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await publishableKeyFor(m, db, {
      ...fakeCanvas,
      encode: async () => { throw new Error('encoder gave up'); },
    })).toBeUndefined();
    // Nothing half-written: no stray blob, no preview key pointing at nothing.
    expect(await db.blobs.count()).toBe(1);
    warn.mockRestore();
  });
});
