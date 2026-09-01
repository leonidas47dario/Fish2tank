import { describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_EDGE, THUMBNAIL_EDGE, deriveRenditions, planRendition, viewableBlobKey,
} from './renditions';

/**
 * The decisions, tested here; the pixels, driven in a browser (spec 029).
 * `createImageBitmap` and `OffscreenCanvas` do not exist under vitest, so
 * encoding is injected - which is also what makes the never-upscale rule and
 * the not-worth-storing rule assertable at all.
 */

describe('planRendition (FR-A08, spec 029)', () => {
  it('scales a large photo down to the target longest edge', () => {
    expect(planRendition({ width: 4000, height: 3000 }, PREVIEW_EDGE))
      .toEqual({ width: 1280, height: 960 });
  });

  it('fits the longest edge whichever way the photo is turned', () => {
    // A portrait fish is still a fish. Fitting width would make a tall photo
    // enormous and a wide one tiny for the same "size".
    expect(planRendition({ width: 3000, height: 4000 }, PREVIEW_EDGE))
      .toEqual({ width: 960, height: 1280 });
  });

  it('NEVER upscales - a small photo gets no rendition at all', () => {
    // The rule that matters. A "preview" larger than the original is more
    // bytes carrying less information, and it inverts the sync queue's
    // thumbnail-first ordering: the cheap thing becomes the expensive one.
    expect(planRendition({ width: 200, height: 150 }, PREVIEW_EDGE)).toBeUndefined();
    expect(planRendition({ width: 300, height: 300 }, THUMBNAIL_EDGE)).toBeUndefined();
  });

  it('treats a photo exactly at the target as needing nothing', () => {
    expect(planRendition({ width: PREVIEW_EDGE, height: 400 }, PREVIEW_EDGE)).toBeUndefined();
  });

  it('never plans a zero-pixel edge for an extreme aspect ratio', () => {
    const plan = planRendition({ width: 8000, height: 3 }, THUMBNAIL_EDGE)!;
    expect(plan.width).toBe(THUMBNAIL_EDGE);
    expect(plan.height).toBeGreaterThanOrEqual(1);
  });
});

describe('viewableBlobKey', () => {
  it('sends the preview when there is one', () => {
    expect(viewableBlobKey({ originalBlobKey: 'orig', previewBlobKey: 'prev' })).toBe('prev');
  });

  it('falls back to the original, which is the NORMAL case for a small photo', () => {
    expect(viewableBlobKey({ originalBlobKey: 'orig' })).toBe('orig');
  });
});

describe('deriveRenditions', () => {
  const bigPhoto = () => ({ size: 3_600_000, type: 'image/jpeg' } as Blob);

  const deps = (encodedBytes: number) => {
    let n = 0;
    return {
      decode: vi.fn(async () => ({ width: 4000, height: 3000 })),
      encode: vi.fn(async () => new ArrayBuffer(encodedBytes)),
      newKey: () => `blob_${++n}`,
    };
  };

  it('derives both renditions from a large photo', async () => {
    const out = await deriveRenditions(bigPhoto(), deps(120_000));

    expect(out.preview?.bytes).toBe(120_000);
    expect(out.thumbnail?.bytes).toBe(120_000);
    expect(out.preview!.key).not.toBe(out.thumbnail!.key);
  });

  it('skips a rendition that came out no smaller than the original', async () => {
    // Re-encoding an already-optimised JPEG can grow it. Storing that spends
    // the budget to make the picture worse.
    const out = await deriveRenditions(bigPhoto(), deps(4_000_000));

    expect(out.preview).toBeUndefined();
    expect(out.thumbnail).toBeUndefined();
  });

  it('keeps the photo when the engine cannot decode it', async () => {
    // The trade this exists to get right: a rendition is an optimisation, and
    // losing a capture to save bytes would be far worse than sending 3.6 MB.
    const out = await deriveRenditions(bigPhoto(), {
      decode: vi.fn(async () => { throw new Error('no createImageBitmap here'); }),
    });

    expect(out).toEqual({});
  });

  it('does not pretend to derive anything from a video', async () => {
    // Extracting a frame needs a <video>, a seek and a paint. Claiming a
    // thumbnail here would write a key pointing at nothing.
    const encode = vi.fn();
    const out = await deriveRenditions({ size: 9_000_000, type: 'video/mp4' } as Blob, { encode });

    expect(out).toEqual({});
    expect(encode).not.toHaveBeenCalled();
  });

  it('releases the decoded bitmap even when encoding throws', async () => {
    const close = vi.fn();
    await deriveRenditions(bigPhoto(), {
      decode: vi.fn(async () => ({ width: 4000, height: 3000, close })),
      encode: vi.fn(async () => { throw new Error('canvas is gone'); }),
    });

    expect(close).toHaveBeenCalled();
  });
});
