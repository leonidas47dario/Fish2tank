/**
 * The key a guest may be sent for one photograph - spec 064, NFR-04.
 *
 * THE LEAK THIS CLOSES. `viewableBlobKey` publishes the preview when one
 * exists and the ORIGINAL otherwise, and its own docstring says that fallback
 * "is not a degraded case, it is the normal one for any photo already smaller
 * than PREVIEW_EDGE". `planRendition` never upscales, so a photo whose longest
 * edge is 1,280px or less has no preview and never will - and publishing it
 * uploaded the keeper's file byte for byte, EXIF and GPS included.
 *
 * A keeper's tank is in their home, so that tag is their home address, on a URL
 * anyone holding the link can open, invisible to both ends. That is what
 * NFR-04's "strip EXIF from future shared derivatives" was written about, and
 * nothing had ever implemented it.
 *
 * WHY THE PREVIEW IS SAFE ALREADY. It is produced by decoding into a canvas and
 * re-encoding, and a canvas holds pixels rather than metadata, so every APP
 * segment is dropped by construction. Measured in Chromium against a JPEG
 * carrying a GPS block: APP1 and the string "Exif" present before, neither
 * after. So this only has to handle the photos that have no preview.
 */
import type { Fish2TankDB } from '../db';
import { blobFor, db } from '../db';
import { stripForSharing } from '../media/renditions';
import type { DeriveDeps } from '../media/renditions';
import type { Media } from '@/domain/types';

/**
 * The blob key to publish for `media`, or `undefined` when there is nothing
 * safe to publish.
 *
 * `undefined` is a real answer with two causes, and the caller must treat both
 * the same way - do not publish this photograph:
 *
 *   - the original blob has not arrived on this device yet
 *   - it is here but cannot be decoded, so it cannot be stripped
 *
 * FAILING CLOSED IS THE POINT. `deriveRenditions` keeps the photograph when a
 * decode fails, which is right for storage; here the same choice would publish
 * the very bytes we were trying to clean.
 */
export async function publishableKeyFor(
  media: Media,
  database: Fish2TankDB = db,
  /**
   * Injected so a test can drive the decision without a canvas, exactly as
   * `deriveRenditions` already allows. The EXIF property itself is a browser
   * behaviour and is measured in one - see the spec - so what these tests can
   * usefully assert is the DECISION: which key, whether a blob is written, and
   * that the original is untouched.
   */
  deps: DeriveDeps = {},
): Promise<string | undefined> {
  // Already clean: a preview is canvas-derived and carries no metadata.
  if (media.previewBlobKey) return media.previewBlobKey;

  const original = blobFor(await database.blobs.get(media.originalBlobKey));
  if (!original) return undefined;

  const stripped = await stripForSharing(original, deps);
  if (!stripped) return undefined;

  /*
   * Stored as the PREVIEW, not as a throwaway.
   *
   * Same pixels as the original, so it is a truthful preview, and keeping it
   * means the "no preview" case stops existing for this photograph: a second
   * publish, and every later read, takes the cheap path above. The original is
   * untouched - NFR-03 is not bent to satisfy NFR-04.
   */
  await database.transaction('rw', [database.media, database.blobs], async () => {
    await database.blobs.add({
      key: stripped.key,
      data: stripped.data,
      bytes: stripped.bytes,
      mimeType: stripped.mimeType,
      storedAt: new Date().toISOString(),
    });
    /*
     * AND QUEUED FOR UPLOAD - spec 067, the half spec 064 left out.
     *
     * `runUploadQueue` walks rows where `syncState !== 'synced'` and sends
     * `transferOrder(media)`. Every row that reaches this line is `synced`:
     * publishing gates on the bytes already being in R2, so a photograph old
     * enough to be shared is a photograph the queue has finished with. Adding
     * a blob to it without reopening the row wrote bytes that NOTHING would
     * ever carry - `headBlob` answered no, the caller dropped the photograph,
     * and it told the keeper to "sync your photos and update the shared page",
     * which could not work however many times they did it.
     *
     * `retry-required` rather than `local-draft`: the row is not a draft, it
     * is a synced row that owes the store one more object, which is exactly
     * what the queue's own failure state means.
     */
    await database.media.update(media.id, {
      previewBlobKey: stripped.key,
      syncState: 'retry-required',
    });
  });

  return stripped.key;
}
