# 020 — A photo is of a fish, so it is added on the fish

**Status:** implemented.
**Date:** 2026-08-30.
**Touches:** FR-J01 (the original is what is kept), FR-T02 (an opening-balance holding has no specimen), NFR-03 (originals never silently altered).
**Follows:** spec 019, which made every kept fish openable and, in doing so, made this the obvious next gap.
**Retires:** the "Which one is this?" picker spec 019 added, four days old.

---

## What was asked

> okay, it now lets me open the profile, however there is no way for me to
> upload the picture. if it says no media, it should instead be a clickable
> button right there for me to upload a photo or take a photo rightly through
> there. This would also make the "+ Add your photo" section redundant, which
> had always been confusing imo.

Two screenshots came with it: a record showing a striped plate reading **"No
media on this catch"**, and the species page's **Card art** panel with its
**+ Add your photo** button.

## The gap was bigger than the screenshot

`SpecimenDetail` never called `addPhotos`. Not a missing button on an empty
state, a missing feature: **the record had no upload path at all**, and the
species page said so in a comment without anyone noticing what it admitted —
*"a fish imported as an opening balance never passed through the Catch screen,
so this is its only route to having its own picture."*

Second, the record rendered `media[0]` and nothing else. `useSpecimenMedia` has
always returned every photo of a specimen, sorted newest first; only the first
was ever drawn. A catch with five photos showed one, with no way to reach the
rest from its own record.

So the upload had to move *and* the record needed somewhere to put more than
one picture. The strip is not a bonus; without it, "add another photo" would
have had no home once the species page's button was gone.

## Decision: the upload moves, the art choice stays

Asked and answered before any code was written, because "makes the Card art
section redundant" has two readings and one of them loses something.

Card art does two different jobs. It **uploads**, and it **chooses** — which of
your photos is the card's face, and whether the card wears your photo or the
reference portrait. Only the first is redundant. Deleting the panel outright
would remove the only way to put a card back to its reference portrait after
photographing the fish through algae, which is exactly the case the panel's own
docstring was written to serve.

So: upload goes, choice stays.

## The change

### 1. `CatchPhotos`, and the plate is the button

A new component owns the record's pictures. When there is no media the whole
plate is a `<button>` reading **Add a photo**, in place of the passive "No
media on this catch" pill. A striped rectangle stating a problem, next to a
control somewhere else that solves it, is two things where the keeper sees one.

**No `capture` attribute.** The species page set `capture="environment"`, which
reads like a helpful default and on iOS forces the camera and removes the photo
library. That is wrong for a fish you already own and photographed last year.
Omitting it gives Take Photo, Photo Library and Choose File, which is what was
asked for.

### 2. Every photo, and a way to add more

Below the plate, a thumbnail strip: tap one to make it the large view, and a
trailing dashed `+` tile to add another. Reuses the `photo-strip` styling
`OwnPhotoStrip` already had. Videos get a poster frame in the strip rather than
a broken tile.

A freshly added photo becomes the large view immediately, rather than leaving
the previous picture up while the new one hides in the strip.

### 3. The species page loses its upload

Gone: the `+ Add your photo` button, its hidden input, `onFiles`,
`targetSpecimenId`, and the "Which one is this?" picker. Kept: the Your photo /
Reference portrait toggle and the strip that chooses the card's face.

**This retires the picker spec 019 added four days ago.** That picker answered
"which of your fish is this a photo of" — a question only a species page has to
ask. A record already knows which fish it is. Moving the upload removed the
ambiguity rather than resolving it, which is the better fix.

The empty-state copy changes with it. "No photo of yours yet. Add one and it
becomes this card's art" asked for a photo and no longer offered any way to
give one, which is the confusion the request named. It now says where.

### 4. A fish you have lost stays reachable

Removing the species upload opened a hole, and closing it is part of this
change rather than a separate improvement.

`ownership()` computes `kept` from `holdings.length` with no quantity filter,
so a species whose every fish has died still reads as yours. `keptFishRows`
dropped holdings at zero quantity. A fish that died therefore had no row in
"Your fish", so no record to open, so — once the species button was gone — **no
route to a photo at all.** The old button reached it, because
`targetSpecimenId` fell back to `holdings[0]` regardless of quantity.

`keptFishRows` now keeps those rows and marks them `pastKept`, displayed as
**"no longer kept"** where the tank name goes.

`pastKept` is deliberately not "quantity is zero". A fish caught and never
brought home is also at zero, and *"not in a tank"* and *"no longer kept"* are
different sentences. The flag means: there was a holding, and there is nothing
left in it.

This is also what Fish Heaven's FH-6 needs — *"Adding a photo must work for a
fish that never had a catch record"* — since a photo you want to attach to a
fish you have lost is the memorial case.

## Out of scope

- **Deleting a photo from a record.** `deleteCatch` removes them with the
  record; there is still no way to remove one picture. Nobody asked, and the
  orphaned-blob rules (BUG-06, spec 012) deserve their own look first.
- **Reordering, captioning or dating photos.** That is ENH-12's timeline.
- **The Catch screen**, which already captures on the way in and is unchanged.

## How this was tested

Per spec 019: this repo has no component test stack, so the decision moved into
a pure function and the wiring was verified in a browser against the production
build.

`keptFishRows` gained four cases — a dead holding still produces a row, a
specimen whose holdings are all empty is past kept, a fish never brought home
is **not**, and a living holding that merely left its tank is **not**. The old
test asserting such rows were hidden was replaced, since that behaviour was
deliberately reversed.

Browser run, one pass covering all six claims:

```
PAST-KEPT ROWS: ["the one that died | no longer kept | no photo yet"]
SPECIES PAGE — file inputs: 0 | "Add your photo": 0 | picker: 0
EMPTY PLATE IS A BUTTON: 1 | label: Add a photo
AFTER UPLOAD — strip tiles: 2 | add tile: 1 | big image: 1
AFTER 2ND — strip tiles: 3
CARD ART — toggle buttons: 2 | choosable photos: 2
LOGS: [mint] … outcome: minted / [photos] added to catch ×2
CONSOLE ERRORS: []
```

1,030 tests across 58 files, up from 1,020 across 57. `npm run build` green.

## Found while verifying, not fixed here

The species tile for a fish that was only ever kept, and is now dead, still
shows the **"Caught"** badge. `ownership()` derives the badge from
`inCollection`, and the distinction between caught and kept is already carried
separately. Cosmetic, predates this change, and untouched by it.

## Acceptance criteria

1. A record with no media shows one control, and it uploads. ✅
2. Both taking a photo and choosing an existing one are offered. ✅
3. A record with media shows all of it and can add more. ✅
4. The species page offers no upload and no "which one" picker. ✅
5. The card art choice and the photo-picking strip still work. ✅
6. A fish where everything died is still listed, still openable, and reads
   "no longer kept" rather than claiming a tank. ✅
7. `vitest run` and `npm run build` both green. ✅
