/**
 * Collecting bytes that nothing points at any more - BUG-06, spec 012.
 *
 * `media` syncs and `blobs` does not (FR-A01), so a delete is only ever half
 * delivered. Clear a tank photo on a tablet that never held the picture and
 * the `media` row is deleted and travels, while the `blobs.delete` beside it
 * is a local no-op - so the phone that took the photo loses the record and
 * keeps the megabytes, with nothing in the database referencing them.
 *
 * THE DELETED MEDIA ROW IS THE TOMBSTONE. That is the whole idea here. Dexie
 * Cloud already delivers the deletion; "no row points at this key" is then a
 * fact any device can check for itself, locally, at any time - so this needs
 * no new synced table, no new rule at the four delete sites, and it collects
 * bytes that were stranded before it was written rather than only bytes
 * stranded after.
 *
 * It rests on one invariant, true of all five writers (`createCatchDraft`,
 * `addPhotos`, `setTankPhoto`, the import restore and the media download
 * queue): a `blobs` row is never created except alongside a `media` row that
 * references it, in the same transaction. If that ever stops being true, this
 * module starts deleting live originals, so it is worth the sentence.
 */
import { db, type Fish2TankDB } from './db';
import { referencedBlobKeys } from './portability/export';

type DB = Fish2TankDB;

export interface BlobSweep {
  /** How many stored blobs were considered. */
  examined: number;
  removed: number;
  /** Measured from the rows themselves, never estimated from a count. */
  bytesReclaimed: number;
  /** Present when the sweep declined to run; see `NO_MEDIA_ROWS`. */
  declined?: typeof NO_MEDIA_ROWS;
}

/**
 * Why a sweep can refuse to do anything at all.
 *
 * An empty `media` table beside a non-empty `blobs` table reads, to this
 * function, as "every byte here is garbage" - and it is far more likely to
 * mean the records have not arrived yet. So the sweep stops.
 *
 * The cost is real and accepted: someone who deletes every last photo keeps
 * the bytes until they add another one. That is a bounded leak, and it is the
 * safe side of a trade whose other side is deleting an original no copy exists
 * of. NFR-03: the local original is the record.
 */
export const NO_MEDIA_ROWS = 'no-media-rows';

/**
 * Read orphans in small batches rather than all at once.
 *
 * `bytes` lives on the row next to `data`, so asking for the size means
 * loading the original. Thirty-two at a time keeps peak memory to a few dozen
 * photos on a first sweep of a neglected device, which is the only time this
 * list is ever long.
 */
const BATCH = 32;

export async function sweepOrphanedBlobs(database: DB = db): Promise<BlobSweep> {
  // Keys only - `primaryKeys()` never loads the bytes, which matters when the
  // table is the whole photo library.
  const stored = (await database.blobs.toCollection().primaryKeys()) as string[];
  const media = await database.media.toArray();

  if (media.length === 0) {
    return { examined: stored.length, removed: 0, bytesReclaimed: 0, declined: NO_MEDIA_ROWS };
  }

  // referencedBlobKeys already covers original, preview and thumbnail. A
  // second copy of that list here is exactly how the two would drift apart.
  const referenced = new Set(referencedBlobKeys(media));
  const orphans = stored.filter((key) => !referenced.has(key));

  let removed = 0;
  let bytesReclaimed = 0;

  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH);
    const rows = await database.blobs.where('key').anyOf(batch).toArray();
    bytesReclaimed += rows.reduce((n, row) => n + (row.bytes ?? 0), 0);
    await database.blobs.bulkDelete(batch);
    removed += batch.length;
  }

  if (removed > 0) {
    // NFR-13: a run that cannot be read afterwards did not happen. Counted in
    // bytes because "12 blobs" says nothing about whether it mattered.
    console.info('[sync] swept orphaned blobs', { examined: stored.length, removed, bytesReclaimed });
  }

  return { examined: stored.length, removed, bytesReclaimed };
}

/**
 * Sweep without letting a failure reach the caller.
 *
 * Housekeeping must never be the reason the app fails to start or a sync run
 * reports an error, so the two call sites use this. It still says what went
 * wrong - swallowed silently, a permanently failing sweep would look exactly
 * like a device with nothing to collect.
 */
export function sweepOrphanedBlobsQuietly(database: DB = db): Promise<BlobSweep | undefined> {
  return sweepOrphanedBlobs(database).catch((cause) => {
    console.warn('[sync] orphaned-blob sweep failed', cause);
    return undefined;
  });
}
