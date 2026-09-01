# 032 — Crop before it becomes a photograph

**Status:** implemented, for the capture path only.
**Date:** 2026-09-01.
**Touches:** ENH-15, FR-C01 (capture), FR-J01 / NFR-03 (the original is never replaced).
**Builds on:** spec 029, which created the canvas pipeline this reuses.

---

## What was asked

> Currently when uploading pics, I cannot crop it. I'd like the ability to crop
> photos when uploading and after it's uploaded.

and then, when asked which shape it should take:

> For cropping I'm open to changing the photo from the beginning rather than a
> rendering trick, how much lift would that be? You decide what's best.

## The two halves are not the same feature

That answer splits the ask cleanly, and only one half is built here.

**At capture — the photo is changed from the beginning, as asked.** The crop
happens *before* anything is stored, so the cropped image simply *is* the
original. No crop rectangle is recorded, nothing downstream learns a new
concept, and every existing reader keeps working untouched.

**After upload — it cannot work that way.** FR-J01 and NFR-03 forbid replacing
a stored original, and that rule is load-bearing elsewhere: it is why the
orphaned-blob sweep declines to run when `media` is empty, and why a shared
page publishes what it does. A later crop must write a new image beside the
untouched one. That is a different operation with a different rule, and doing
it in the same change would have blurred the two.

## NFR-03 is not bent, and it looks like it should be

Worth being precise, because "the crop replaces the photo" sounds exactly like
what NFR-03 forbids.

The rule is that a **stored** original is never silently downsampled or
replaced. Here the keeper is choosing what the photograph *is*, in the same
breath as taking it, and only that choice ever reaches the database. Nothing is
overwritten because nothing exists yet. The word doing the work is *silently*:
this is the opposite of silent — it is the whole interaction.

## Decisions

### Cropping is never compulsory

The selection starts as the whole frame, and "Use photo" with nothing moved
stores the file **byte for byte**: `cropToBlob` returns `undefined` for an
untouched selection rather than re-encoding it. Declining to crop therefore
costs no quality at all, which matters because re-encoding every photo through
a crop sheet nobody used would be a silent tax on every capture.

### Quality 0.95, deliberately higher than a rendition

This output becomes the ORIGINAL. Spec 029's renditions are where the saving
belongs; compressing here would mean the only copy is the compressed one.

### One photo at a time, and never a video

Several files at once are stored as they were: a queue of crop sheets is a
worse flow than cropping afterwards, one at a time. A video is not cropped
because that needs frame-accurate seeking this does not have, and a crop sheet
that silently does nothing would be worse than no sheet.

### A failure keeps the photograph whole

`cropToBlob` returns `undefined` when the engine cannot decode or encode, and
the caller stores the file untouched — the same trade `deriveRenditions` makes.
A crop is a preference; the photograph is the point.

### The geometry is the part with rules

Two things a dragging finger finds within seconds, and both are pure functions
with tests: a selection dragged off the edge (it stops, it does not shrink —
shrinking makes the box feel like it is fighting back), and a corner dragged
past its opposite (clamped, because a negative width is something canvas
accepts and then draws as nothing).

## Measured, not asserted

The unit tests inject the encoder, so they cannot show that a crop changes any
pixels. Driven in a real browser against the built bundle, using a source whose
left half is red and right half is blue, cropping to the right half:

| | |
|---|---|
| source | 1000×600, 5,714 bytes |
| cropped | **500×600**, 3,673 bytes |
| blue pixels in the result | **300,000** — exactly 500×600 |
| red pixels in the result | **0** |
| untouched selection recognised | yes (no re-encode) |

Zero red is the assertion that matters: the discarded half is genuinely gone,
not merely hidden.

## Not done here

- **Cropping after upload**, above — the larger half of ENH-15, and the one
  that needs the write-beside-the-original rule.
- **`CatchScreen`'s capture button**, which still stores what the camera
  returns. Wiring it is the same two calls; it is left out only so this change
  stays one surface at a time.
- **Rotation and straightening**, which nobody asked for.

## Acceptance criteria

1. Picking one photo opens a crop sheet before it is stored. ✅
2. The selection starts as the whole frame. ✅
3. Accepting without moving anything stores the file byte for byte. ✅
4. A crop actually removes the discarded pixels. ✅ (browser)
5. The selection cannot leave the picture or invert. ✅ (tests)
6. Several files, or a video, bypass the sheet. ✅
7. An engine that cannot crop keeps the photo whole. ✅
8. `vitest run` and `npm run build` both green. ✅
