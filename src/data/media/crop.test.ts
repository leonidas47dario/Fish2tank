import { describe, expect, it, vi } from 'vitest';
import {
  MIN_CROP_PX, clampRect, cropToBlob, isWholeFrame, moveRect, resizeRect, wholeFrame,
} from './crop';

/**
 * The geometry, tested here; the pixels, driven in a browser (spec 032).
 *
 * The rules worth guarding are the ones a dragging finger will find within
 * seconds: a rectangle that escapes the picture, and a corner dragged past its
 * opposite so the selection turns inside out.
 */

const bounds = { width: 4000, height: 3000 };

describe('clampRect', () => {
  it('keeps a selection inside the picture without shrinking it', () => {
    // Sliding off the edge should STOP at the edge. Shrinking instead makes
    // the selection feel like it is fighting the finger.
    const out = clampRect({ x: -500, y: -500, width: 1000, height: 800 }, bounds);

    expect(out).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it('stops at the far edge too', () => {
    const out = clampRect({ x: 3800, y: 2900, width: 1000, height: 800 }, bounds);

    expect(out.x + out.width).toBe(bounds.width);
    expect(out.y + out.height).toBe(bounds.height);
  });

  it('never lets a selection exceed the picture', () => {
    const out = clampRect({ x: 0, y: 0, width: 9999, height: 9999 }, bounds);

    expect(out).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });

  it('enforces a minimum, so a slip does not photograph nothing', () => {
    const out = clampRect({ x: 10, y: 10, width: 2, height: 2 }, bounds);

    expect(out.width).toBe(MIN_CROP_PX);
    expect(out.height).toBe(MIN_CROP_PX);
  });
});

describe('moveRect', () => {
  it('drags the selection', () => {
    expect(moveRect({ x: 100, y: 100, width: 500, height: 400 }, 50, -30, bounds))
      .toEqual({ x: 150, y: 70, width: 500, height: 400 });
  });
});

describe('resizeRect', () => {
  const rect = { x: 1000, y: 1000, width: 1000, height: 1000 };

  it('moves the origin when dragging the north-west corner', () => {
    const out = resizeRect(rect, 'nw', -200, -200, bounds);

    expect(out).toEqual({ x: 800, y: 800, width: 1200, height: 1200 });
  });

  it('pins the opposite corner when dragging south-east', () => {
    const out = resizeRect(rect, 'se', 300, 200, bounds);

    expect(out.x).toBe(1000);
    expect(out.y).toBe(1000);
    expect(out.width).toBe(1300);
    expect(out.height).toBe(1200);
  });

  it('CANNOT be turned inside out by dragging a corner past its opposite', () => {
    // The rule that stops a negative width, which canvas would happily accept
    // and then draw as nothing.
    const out = resizeRect(rect, 'nw', 5000, 5000, bounds);

    expect(out.width).toBe(MIN_CROP_PX);
    expect(out.height).toBe(MIN_CROP_PX);
    expect(out.x + out.width).toBe(2000);
    expect(out.y + out.height).toBe(2000);
  });

  it('cannot be dragged out of the picture', () => {
    const se = resizeRect(rect, 'se', 9999, 9999, bounds);
    expect(se.x + se.width).toBe(bounds.width);
    expect(se.y + se.height).toBe(bounds.height);

    const nw = resizeRect(rect, 'nw', -9999, -9999, bounds);
    expect(nw.x).toBe(0);
    expect(nw.y).toBe(0);
  });
});

describe('wholeFrame / isWholeFrame', () => {
  it('recognises an untouched selection, so nothing is re-encoded for nothing', () => {
    expect(isWholeFrame(wholeFrame(bounds), bounds)).toBe(true);
    expect(isWholeFrame({ x: 1, y: 0, width: 3999, height: 3000 }, bounds)).toBe(false);
  });
});

describe('cropToBlob', () => {
  const photo = () => ({ size: 3_600_000, type: 'image/jpeg' } as Blob);
  const decode = vi.fn(async () => ({ width: 4000, height: 3000 }));

  it('returns nothing when the selection is the whole photo', async () => {
    // Re-encoding an untouched photo would lose quality for no crop at all.
    const encode = vi.fn();
    const out = await cropToBlob(photo(), wholeFrame(bounds), { decode, encode });

    expect(out).toBeUndefined();
    expect(encode).not.toHaveBeenCalled();
  });

  it('crops, and clamps a selection that escaped the picture', async () => {
    const encode = vi.fn(async () => ({ size: 900_000, type: 'image/jpeg' } as Blob));
    await cropToBlob(photo(), { x: -100, y: -100, width: 1000, height: 800 }, { decode, encode });

    expect(encode).toHaveBeenCalledWith(
      expect.anything(), { x: 0, y: 0, width: 1000, height: 800 }, 0.95,
    );
  });

  it('keeps the photo whole when the engine cannot decode', async () => {
    const out = await cropToBlob(photo(), { x: 0, y: 0, width: 100, height: 100 }, {
      decode: vi.fn(async () => { throw new Error('no createImageBitmap'); }),
    });

    expect(out).toBeUndefined();
  });

  it('does not crop a video', async () => {
    const encode = vi.fn();
    const out = await cropToBlob({ size: 9_000_000, type: 'video/mp4' } as Blob,
      { x: 0, y: 0, width: 100, height: 100 }, { encode });

    expect(out).toBeUndefined();
    expect(encode).not.toHaveBeenCalled();
  });

  it('releases the decoded bitmap even when encoding throws', async () => {
    const close = vi.fn();
    await cropToBlob(photo(), { x: 0, y: 0, width: 500, height: 500 }, {
      decode: vi.fn(async () => ({ width: 4000, height: 3000, close })),
      encode: vi.fn(async () => { throw new Error('canvas gone'); }),
    });

    expect(close).toHaveBeenCalled();
  });
});
