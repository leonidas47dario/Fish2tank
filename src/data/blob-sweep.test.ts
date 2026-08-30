import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from './db';
import { NO_MEDIA_ROWS, sweepOrphanedBlobs } from './blob-sweep';
import type { Media } from '@/domain/types';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();
});

/** A stored blob of a given size, so `bytesReclaimed` has something to measure. */
async function storeBlob(key: string, bytes: number) {
  await db.blobs.add({
    key,
    data: new Uint8Array(bytes).buffer,
    bytes,
    mimeType: 'image/jpeg',
    storedAt: '2026-08-30T00:00:00.000Z',
  });
}

function mediaRow(over: Partial<Media> & Pick<Media, 'id' | 'originalBlobKey'>): Media {
  return {
    kind: 'photo',
    specimenIds: [],
    originalBytes: 4,
    mimeType: 'image/jpeg',
    capturedAt: '2026-08-30T00:00:00.000Z',
    syncState: 'synced',
    ...over,
  };
}

describe('orphaned blob sweep (BUG-06, spec 012)', () => {
  it('collects bytes whose media row was deleted on another device', async () => {
    // The bug, reproduced. The tablet deleted `media_gone` and the deletion
    // synced here; its `blobs.delete` was a local no-op over there, so this
    // device kept the megabytes with nothing pointing at them.
    await storeBlob('blob_kept', 100);
    await storeBlob('blob_orphan', 4096);
    await db.media.add(mediaRow({ id: 'media_kept', originalBlobKey: 'blob_kept' }));

    const swept = await sweepOrphanedBlobs(db);

    expect(swept).toEqual({ examined: 2, removed: 1, bytesReclaimed: 4096 });
    expect(await db.blobs.get('blob_orphan')).toBeUndefined();
    expect(await db.blobs.get('blob_kept')).toBeDefined();
  });

  it('keeps previews and thumbnails, not just originals', async () => {
    // The four delete sites only ever removed `originalBlobKey`, so a sweep
    // that looked at originals alone would collect every derived blob in the
    // database on its first run.
    await storeBlob('blob_original', 900);
    await storeBlob('blob_preview', 300);
    await storeBlob('blob_thumb', 100);
    await db.media.add(mediaRow({
      id: 'media_full',
      originalBlobKey: 'blob_original',
      previewBlobKey: 'blob_preview',
      thumbnailBlobKey: 'blob_thumb',
    }));

    const swept = await sweepOrphanedBlobs(db);

    expect(swept.removed).toBe(0);
    expect(await db.blobs.count()).toBe(3);
  });

  it('refuses to run when there are no media rows at all', async () => {
    // An empty media table beside stored bytes reads as "every byte here is
    // garbage" and is far more likely to mean the records have not arrived.
    await storeBlob('blob_orphan', 4096);

    const swept = await sweepOrphanedBlobs(db);

    expect(swept.declined).toBe(NO_MEDIA_ROWS);
    expect(swept.removed).toBe(0);
    expect(await db.blobs.get('blob_orphan')).toBeDefined();
  });

  it('is a no-op on a device with nothing to collect', async () => {
    await storeBlob('blob_kept', 100);
    await db.media.add(mediaRow({ id: 'media_kept', originalBlobKey: 'blob_kept' }));

    expect(await sweepOrphanedBlobs(db)).toEqual({
      examined: 1,
      removed: 0,
      bytesReclaimed: 0,
    });
  });

  it('removes nothing the second time', async () => {
    await storeBlob('blob_kept', 100);
    await storeBlob('blob_orphan', 4096);
    await db.media.add(mediaRow({ id: 'media_kept', originalBlobKey: 'blob_kept' }));

    await sweepOrphanedBlobs(db);
    const again = await sweepOrphanedBlobs(db);

    expect(again).toEqual({ examined: 1, removed: 0, bytesReclaimed: 0 });
  });

  it('collects more orphans than one batch holds', async () => {
    // The batching exists so a first sweep of a neglected device does not load
    // every stranded original into memory at once; it must not lose any.
    for (let i = 0; i < 70; i += 1) await storeBlob(`blob_orphan_${i}`, 10);
    await storeBlob('blob_kept', 100);
    await db.media.add(mediaRow({ id: 'media_kept', originalBlobKey: 'blob_kept' }));

    const swept = await sweepOrphanedBlobs(db);

    expect(swept).toEqual({ examined: 71, removed: 70, bytesReclaimed: 700 });
    expect(await db.blobs.count()).toBe(1);
  });
});
