/**
 * Reading a photograph at the size it is about to be drawn - spec 036.
 *
 * WHY THIS IS NOT JUST A KEY LOOKUP. `blobKeyLadder` answers which renditions
 * a `media` row CLAIMS to have. On the device that took the photograph those
 * two things are the same, and a caller could resolve one key and stop.
 *
 * On a second device they are not. Blobs arrive through the sync queue, which
 * sends thumbnails first, then previews, then originals (FR-A03), so a row
 * that has synced can name three keys while only one of the three blobs has
 * landed. A reader that trusted the row would draw nothing on exactly the
 * device where the ordering was supposed to help most.
 *
 * So the ladder is walked against storage. The first rung that is actually
 * present wins, and a picture appears as soon as ANY size of it exists.
 */
import { blobFor, db, type Fish2TankDB } from '../db';
import { blobKeyLadder, type RenditionKeys, type RenditionSize } from './renditions';

/**
 * The best available blob for one picture, or `undefined` if none has arrived.
 *
 * `undefined` means "no size of this photograph is on this device", which is a
 * real state - a fresh device mid-sync - and not an error.
 */
export async function readMediaBlob(
  media: RenditionKeys,
  size: RenditionSize,
  /** Injected by the tests, as everywhere else in `data/`. */
  database: Fish2TankDB = db,
): Promise<Blob | undefined> {
  for (const key of blobKeyLadder(media, size)) {
    const blob = blobFor(await database.blobs.get(key));
    if (blob) return blob;
  }
  return undefined;
}
