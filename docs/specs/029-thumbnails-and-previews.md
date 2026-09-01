# 029 — Thumbnails and previews, so the promises stop being aspirational

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-A08 (the unbuilt requirement this closes), FR-A03 (thumbnail-first sync ordering), FR-J01 / NFR-03 (the original is never replaced), ENH-14 (a shared tank sending untouched originals).
**Unblocks:** ENH-15, which needs the same canvas pipeline.

---

## Why now

Three promises the app has been making without the means to keep them:

1. **Spec 005 FR-A03** says the sync queue prioritises *"thumbnails, then
   previews, then originals"*. `transferOrder()` implements that ordering
   exactly — and had nothing to order, because every `media` row carried only
   `originalBlobKey`.
2. **A shared tank sends the keeper's untouched originals**, measured at 3.6 MB
   each in spec 005. Spec 026 multiplied that from one photo per tank to one
   per photographed fish. Lazy tiles defer the cost; nothing has made it cheap.
3. **A new device pulls full originals** before it can draw a single picture.

`Media` has carried `previewBlobKey` and `thumbnailBlobKey` since the schema
was written. This populates them.

## NFR-03 is the rule, and it is easy to break here

The original is never read back and rewritten, never downsampled in place,
never replaced. Renditions are **additional** blobs beside it. Every reader
falls back to the original, so a photo with no rendition is not a degraded
case — it is the normal case for anything already small.

**Checked before building, not after:** the orphaned-blob sweep (BUG-06, spec
012) treats all three keys as referenced, via `referencedBlobKeys`. Had it
looked only at `originalBlobKey`, every derived blob would have been swept as
an orphan the moment it was written.

## The decisions

### Never upscale

`planRendition` returns nothing when the source is already at or under the
target. A "preview" larger than its original is more bytes carrying less
information, and it inverts FR-A03's ordering: the cheap thing becomes the
expensive one. This is the rule most worth a test, and it has four.

### A rendition no smaller than the original is discarded

Re-encoding an already-optimised JPEG can grow it. Storing that spends the
25 MB budget to make the picture worse.

### Losing a capture to save bytes is the wrong trade

`deriveRenditions` returns `{}` rather than throwing when the engine cannot
decode or encode. A device without `createImageBitmap` or `OffscreenCanvas`
still keeps the photograph, at full size. The rendition is an optimisation;
the photograph is the point.

### Video is not handled, and says so

Extracting a frame needs a `<video>`, a seek and a paint — different work with
its own failure modes. Claiming a thumbnail here would write a key pointing at
nothing.

### Shared pages send the preview

`viewableBlobKey` picks preview-then-original, and the share publisher HEADs
*that* key. Safe because `transferOrder` uploads thumbnail and preview
**before** the original, so at publish time a preview is more likely present
than the original it replaces, not less.

## Measured, not estimated

Driven in a real browser against the built bundle, because the unit tests
inject the encoder and therefore cannot prove the canvas path works at all:

| | dimensions | bytes | saving |
|---|---|---|---|
| original | 4000×3000 | 638,572 | — |
| preview | 1280×960 | 70,091 | **89.0%** |
| thumbnail | 320×240 | 12,248 | **98.1%** |

A 200×150 source correctly produced no rendition.

**That source was synthetic** — a gradient with drawn detail, not a photograph.
The ratios are indicative of the shape of the win, not a promise about a
specific fish picture, and this spec will not restate them as one. What is
certain is the direction and that the mechanism works in a real engine.

## Not done here

- **Backfilling existing photos.** Every photo already captured keeps only its
  original, so shared pages of old tanks are as heavy as before. A migration
  would need to decode every stored blob on some device and is its own piece of
  work with its own budget question.
- **Video thumbnails**, above.
- **`setTankPhoto`** still stores its buffer unchanged; only `addPhotos` derives
  today. The tank photo is one image per tank rather than one per fish, so it
  is the smaller half of the cost.

## Acceptance criteria

1. A large photo added through `addPhotos` gains both renditions, stored as
   separate blobs. ✅
2. The original is byte-identical to what was captured. ✅ (never read back)
3. A small photo gains none, and everything still renders. ✅
4. A rendition that came out no smaller than its original is not stored. ✅
5. A device that cannot resize still keeps the photo. ✅
6. Shared pages publish the preview where one exists. ✅
7. The sweep does not collect a freshly derived blob. ✅ (verified in
   `referencedBlobKeys` before building)
8. `vitest run` and `npm run build` both green. ✅
