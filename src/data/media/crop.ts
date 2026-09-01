/**
 * Cropping a photo before it is ever stored - ENH-15, spec 032.
 *
 * WHY THIS CROPS THE BYTES RATHER THAN RECORDING A RECTANGLE. Asked which he
 * wanted, the keeper said: *"I'm open to changing the photo from the beginning
 * rather than a rendering trick."* So at capture the cropped image IS the
 * original - there is no second source of truth, nothing downstream has to
 * learn about crop rectangles, and every existing reader keeps working.
 *
 * NFR-03 IS NOT BENT BY THIS, and the distinction is worth being precise
 * about, because it looks like it should be. The rule is that a STORED
 * original is never silently downsampled or replaced. Here the crop happens
 * BEFORE anything is stored: the keeper is choosing what the photograph is, in
 * the same breath as taking it, and only that choice reaches the database.
 * Nothing is overwritten because nothing exists yet.
 *
 * That is why this module is only ever called on the capture path. Cropping a
 * photo that has ALREADY been stored is a different operation with a different
 * rule - it must write a new image beside the untouched original - and it is
 * deliberately not done here.
 */

export interface CropRect {
  /** All four in source pixels, with the origin at the top left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  width: number;
  height: number;
}

/**
 * The smallest crop worth allowing, in source pixels.
 *
 * Below this a "crop" is a slip of the finger rather than an intention, and it
 * produces a photograph of nothing that cannot be undone - the original was
 * never stored.
 */
export const MIN_CROP_PX = 64;

/** The whole photo. The default, because cropping must never be compulsory. */
export function wholeFrame(bounds: Bounds): CropRect {
  return { x: 0, y: 0, width: bounds.width, height: bounds.height };
}

/** Whether this crop would actually change anything. */
export function isWholeFrame(rect: CropRect, bounds: Bounds): boolean {
  return rect.x === 0 && rect.y === 0
    && rect.width === bounds.width && rect.height === bounds.height;
}

/**
 * Keep a rectangle inside the picture, without changing its size if it fits.
 *
 * Sliding a crop off the edge should stop it at the edge, not shrink it -
 * shrinking makes the selection feel like it is fighting back.
 */
export function clampRect(rect: CropRect, bounds: Bounds): CropRect {
  const width = Math.min(Math.max(rect.width, MIN_CROP_PX), bounds.width);
  const height = Math.min(Math.max(rect.height, MIN_CROP_PX), bounds.height);
  return {
    width,
    height,
    x: Math.min(Math.max(rect.x, 0), bounds.width - width),
    y: Math.min(Math.max(rect.y, 0), bounds.height - height),
  };
}

/** Drag the whole selection. */
export function moveRect(rect: CropRect, dx: number, dy: number, bounds: Bounds): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Drag one corner, with the opposite corner pinned.
 *
 * The pinned corner is the whole reason this is not two lines: dragging the
 * north-west handle moves the origin AND changes the size, and letting the
 * width go negative flips the rectangle inside out. Clamping the moving edge
 * against the pinned one keeps that impossible.
 */
export function resizeRect(
  rect: CropRect, corner: Corner, dx: number, dy: number, bounds: Bounds,
): CropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';

  // The moving edges, clamped so they can never cross the pinned ones.
  const nextLeft = west
    ? Math.min(Math.max(left + dx, 0), right - MIN_CROP_PX)
    : left;
  const nextRight = west
    ? right
    : Math.max(Math.min(right + dx, bounds.width), left + MIN_CROP_PX);
  const nextTop = north
    ? Math.min(Math.max(top + dy, 0), bottom - MIN_CROP_PX)
    : top;
  const nextBottom = north
    ? bottom
    : Math.max(Math.min(bottom + dy, bounds.height), top + MIN_CROP_PX);

  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  };
}

/**
 * Produce the cropped image.
 *
 * Returns `undefined` rather than throwing when the engine cannot do it, and
 * the caller then keeps the photograph whole - the same trade `deriveRenditions`
 * makes. A crop is a preference; the photograph is the point.
 *
 * Quality is deliberately high (0.95). This output becomes the ORIGINAL, and
 * the renditions derived from it afterwards are where the saving belongs.
 * Compressing here would mean the only copy is the compressed one.
 */
export async function cropToBlob(
  source: Blob,
  rect: CropRect,
  deps: {
    decode?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
    encode?: (bitmap: unknown, rect: CropRect, quality: number) => Promise<Blob>;
  } = {},
): Promise<Blob | undefined> {
  if (!source.type.startsWith('image/')) return undefined;

  const decode = deps.decode ?? (async (b: Blob) => {
    const bitmap = await createImageBitmap(b);
    return { width: bitmap.width, height: bitmap.height, close: () => bitmap.close(), bitmap } as never;
  });
  const encode = deps.encode ?? (async (src: unknown, r: CropRect, quality: number) => {
    const { bitmap } = src as { bitmap: ImageBitmap };
    const canvas = new OffscreenCanvas(Math.round(r.width), Math.round(r.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  });

  let decoded: { width: number; height: number; close?: () => void };
  try {
    decoded = await decode(source);
  } catch (cause) {
    console.warn('[crop] could not decode; keeping the photo whole', { cause: String(cause) });
    return undefined;
  }

  try {
    const safe = clampRect(rect, decoded);
    if (isWholeFrame(safe, decoded)) return undefined;
    const out = await encode(decoded, safe, 0.95);
    console.info('[crop] cropped', {
      from: `${decoded.width}x${decoded.height}`,
      to: `${Math.round(safe.width)}x${Math.round(safe.height)}`,
      bytes: out.size,
    });
    return out;
  } catch (cause) {
    console.warn('[crop] could not encode; keeping the photo whole', { cause: String(cause) });
    return undefined;
  } finally {
    decoded.close?.();
  }
}
