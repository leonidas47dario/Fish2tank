/**
 * Thumbnails and previews derived from an original - FR-A08, spec 029.
 *
 * WHAT THIS UNBLOCKS. Three promises the app has been making without the means
 * to keep them:
 *
 *   - Spec 005 FR-A03 says the sync queue prioritises "thumbnails, then
 *     previews, then originals". That ordering has had nothing to order:
 *     every `media` row carried only `originalBlobKey`.
 *   - A shared tank (spec 026) sends the keeper's untouched originals,
 *     measured at 3.6 MB each in spec 005. Lazy tiles defer that; nothing has
 *     made it cheap.
 *   - A new device pulls full originals before it can draw a single picture.
 *
 * NFR-03 IS THE RULE THIS OBEYS. The original is never read back and rewritten,
 * never downsampled in place, and never replaced. Renditions are additional
 * blobs beside it, and `Media` has carried `previewBlobKey` and
 * `thumbnailBlobKey` since the schema was written - they were simply never
 * populated. Deriving them is additive in the strictest sense.
 *
 * The orphaned-blob sweep (BUG-06, spec 012) already counts all three keys as
 * referenced, via `referencedBlobKeys`, so a derived blob is not swept the
 * moment it is written. That was checked before this was built rather than
 * discovered afterwards.
 */

/** Longest edge, in CSS pixels, of each rendition. */
export const THUMBNAIL_EDGE = 320;
export const PREVIEW_EDGE = 1280;

/** JPEG quality for derived renditions. Never applied to an original. */
export const RENDITION_QUALITY = 0.82;

export interface RenditionPlan {
  width: number;
  height: number;
}

/**
 * The size a rendition should be, or `undefined` when it should not exist.
 *
 * NEVER UPSCALES, and that is the whole of the logic worth testing. A "preview"
 * larger than the original would be more bytes carrying less information, and
 * it would make the sync queue's thumbnail-first ordering actively wrong: the
 * cheap thing would be the expensive one. A picture already smaller than the
 * target simply has no rendition, and callers fall back to the original.
 *
 * Aspect ratio is preserved by fitting the longest edge, because a tank tile
 * crops with `object-fit` and a distorted fish is worse than a cropped one.
 */
export function planRendition(
  source: { width: number; height: number },
  edge: number,
): RenditionPlan | undefined {
  const longest = Math.max(source.width, source.height);
  if (longest <= edge) return undefined;

  const scale = edge / longest;
  return {
    // Round rather than floor: flooring a 1-pixel-over image to the target
    // minus one is a rendition nobody asked for, at no saving.
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Which blob a viewer should be sent.
 *
 * Preview when there is one, original otherwise - and the fallback is not a
 * degraded case, it is the normal one for any photo already smaller than
 * `PREVIEW_EDGE`. Pure so the projection can call it without a browser.
 */
export function viewableBlobKey(
  media: { originalBlobKey: string; previewBlobKey?: string },
): string {
  return media.previewBlobKey ?? media.originalBlobKey;
}

export interface DerivedRendition {
  key: string;
  data: ArrayBuffer;
  bytes: number;
  mimeType: string;
}

export interface DeriveDeps {
  /** Injected so a test can drive this without a canvas. */
  decode?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  encode?: (
    source: unknown, plan: RenditionPlan, quality: number,
  ) => Promise<ArrayBuffer>;
  newKey?: () => string;
}

/**
 * Derive what is worth deriving from one image.
 *
 * Returns nothing rather than throwing when the browser cannot do it. A device
 * whose engine lacks `createImageBitmap` or `OffscreenCanvas` must still be
 * able to keep a photo - the rendition is an optimisation, and losing the
 * capture to save bytes would be the wrong trade by a wide margin.
 *
 * VIDEO IS NOT HANDLED and returns nothing. Extracting a frame needs a
 * `<video>` element, a seek and a paint, which is a different piece of work
 * with its own failure modes; pretending otherwise here would produce a
 * thumbnail key pointing at nothing.
 */
export async function deriveRenditions(
  blob: Blob,
  deps: DeriveDeps = {},
): Promise<{ thumbnail?: DerivedRendition; preview?: DerivedRendition }> {
  if (!blob.type.startsWith('image/')) return {};

  const decode = deps.decode ?? defaultDecode;
  const encode = deps.encode ?? defaultEncode;
  const newKey = deps.newKey ?? (() => `blob_${crypto.randomUUID()}`);

  let source: { width: number; height: number; close?: () => void };
  try {
    source = await decode(blob);
  } catch (cause) {
    console.warn('[renditions] could not decode; keeping the original alone', { cause: String(cause) });
    return {};
  }

  try {
    const out: { thumbnail?: DerivedRendition; preview?: DerivedRendition } = {};
    for (const [name, edge] of [['preview', PREVIEW_EDGE], ['thumbnail', THUMBNAIL_EDGE]] as const) {
      const plan = planRendition(source, edge);
      if (!plan) continue;
      try {
        const data = await encode(source, plan, RENDITION_QUALITY);
        // A rendition no smaller than the original is not worth storing, and
        // can happen: re-encoding an already-optimised JPEG sometimes grows it.
        if (data.byteLength >= blob.size) {
          console.info('[renditions] skipped, no smaller than the original', {
            rendition: name, derived: data.byteLength, original: blob.size,
          });
          continue;
        }
        out[name] = { key: newKey(), data, bytes: data.byteLength, mimeType: 'image/jpeg' };
      } catch (cause) {
        console.warn('[renditions] could not encode', { rendition: name, cause: String(cause) });
      }
    }
    console.info('[renditions] derived', {
      source: `${source.width}x${source.height}`,
      originalBytes: blob.size,
      preview: out.preview?.bytes,
      thumbnail: out.thumbnail?.bytes,
    });
    return out;
  } finally {
    source.close?.();
  }
}

async function defaultDecode(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  return { width: bitmap.width, height: bitmap.height, close: () => bitmap.close(), bitmap } as never;
}

async function defaultEncode(source: unknown, plan: RenditionPlan, quality: number) {
  const { bitmap } = source as { bitmap: ImageBitmap };
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context');
  ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return out.arrayBuffer();
}
