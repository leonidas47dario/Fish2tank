# 064 — Nothing leaves with a location attached

## What was asked

> Agree to work on "EXIF stripping (NFR-04)"

Raised as the first of three, ahead of the share-link preview, on the argument
that a preview puts an image in front of every unfurler that touches the link.

## This is not a feature. It is a requirement the app does not meet.

**NFR-04**, verbatim from `docs/PRD.md`:

> Private by default; never publish exact home location; strip EXIF from future
> shared derivatives.

`grep -rn "EXIF\|exif" src/ worker/src/` returns **nothing**. No code has ever
implemented that clause.

## What is actually leaking, measured rather than assumed

Half of NFR-04 turns out to be satisfied **by accident**, and finding out which
half is what makes this small instead of large.

`deriveRenditions` builds a preview and a thumbnail by decoding into a canvas
and re-encoding. A canvas holds pixels, not metadata, so the re-encode discards
every APP segment. Verified in Chromium against a JPEG carrying a GPS EXIF
block, through the same decode/draw/encode the app uses:

```
source JPEG with GPS EXIF     APP1: yes    "Exif": yes    3,677 bytes
after the canvas rendition    APP1: no     "Exif": no     1,211 bytes
```

So every preview and every thumbnail is already clean.

**The leak is the photos that have no preview.** `viewableBlobKey` is what the
publisher uploads, and its own docstring says exactly when that happens:

> Preview when there is one, original otherwise — and the fallback is not a
> degraded case, it is the normal one for any photo already smaller than
> `PREVIEW_EDGE`.

`planRendition` never upscales and discards a rendition no smaller than its
source, so **a photo whose longest edge is 1,280 pixels or less has no preview,
and publishing it uploads the original byte for byte** — EXIF, GPS and all.

That is a real population, not a corner: an image forwarded through a messaging
app, a screenshot, a photo from an older camera, anything already downscaled
before it reached the app. A phone's own 4,000-pixel camera file is safe
precisely because it is big enough to earn a preview, which is the opposite of
the intuition.

**The exposure, stated plainly:** a keeper's tank is in their home, so a GPS tag
on a published photograph is their home address, published to a URL anyone
holding the link can open, and neither they nor the recipient can see it.

## Scope

**In:** no photograph leaves the device carrying EXIF.

**Out:**

- **Stripping the stored original.** NFR-03 makes the original the one thing
  that must never be replaced, and the EXIF on it is the keeper's own — date
  taken, camera, orientation. NFR-04 says *shared derivatives*, and that word
  is doing real work: this is about what leaves, not what is kept.
- **Anything already in the bucket.** Objects published before this keep their
  EXIF and the Worker has no delete route (ENH-11). Retro-cleaning is its own
  problem and is filed rather than smuggled in — see "What this does not fix".
- **The share-link preview (ENH-18).** This unblocks it; it does not build it.
- **Coarse-location features.** Spec 061's "near me" inherits this rule; it
  does not arrive with it.

## Design

**Publish never uploads an original.** When a photo has no preview, one is
derived at publish time at the photo's own size — no upscale, no crop, same
pixels — purely so the encode drops the metadata. It is stored as the preview,
so the work happens once and the "no preview" case stops existing for anything
published.

This reuses the mechanism that is already provably clean rather than adding an
EXIF parser. **Writing a metadata stripper by hand would be the wrong move**:
it would mean enumerating every segment that can carry location — APP1/Exif,
APP13/IPTC, XMP, and whatever a future camera invents — and being wrong once is
a leak. A canvas keeps only pixels, which is a whitelist by construction.

`planRendition` cannot be reused as-is: it deliberately returns nothing when the
source is already at or under the target, and discards a rendition no smaller
than its source. Both rules are right for their job — a preview larger than its
original is more bytes carrying less information — and both would decline
exactly the case this spec is about. So the strip is its own named function with
its own reason, rather than a flag that quietly inverts two existing rules.

**The cost:** one re-encode of an already-small image, once, at publish. The
stored blob may come out slightly larger or smaller than the original; either is
acceptable because the alternative is publishing a location.

## Acceptance criteria

1. A JPEG carrying an EXIF GPS block, stored as a photo with **no preview**, is
   published as a derivative containing no APP1 segment and no `Exif` marker.
   Driven against real bytes, not a mock.
2. The **stored original is unchanged** after publishing — same key, same
   bytes, EXIF intact. NFR-03 is not bent to satisfy NFR-04.
3. A photo that already has a preview publishes that preview, with no extra
   derivation and no second upload.
4. A photo whose source cannot be decoded is **not published**, rather than
   published unstripped. Failing closed is the whole point; spec 029's
   `deriveRenditions` returns `{}` on a decode failure and keeps the
   photograph, which is right for storage and wrong here.
5. `viewableBlobKey` never returns an `originalBlobKey` to the publisher.

## Alternatives rejected

**Strip at capture, before the original is stored.** Spec 032 set the precedent
that modifying before first store is not an NFR-03 violation, so this is
available. Rejected because it destroys the keeper's own provenance for a
problem that only exists at the moment of publishing, and because it would do
nothing for the photographs already stored.

**Parse and rewrite the JPEG segments.** Keeps the original bytes and strips
only metadata, so no re-encode and no quality loss. Rejected on the failure
mode: a whitelist of pixels cannot miss a metadata segment, an enumerated
blacklist can, and the cost of missing one is a published home address.

**Strip in the Worker, on the way into R2.** One place, covers every future
upload route. Rejected because the Worker deliberately never touches the bytes
— it mints presigned URLs so a 3.6 MB photo stays off its CPU budget entirely
(`worker/src/index.ts`) — and reversing that is a larger architectural change
than this requires.

**Do nothing until ENH-18.** Rejected: the leak exists today, on every shared
tank, and the preview only widens it.

## What this does not fix, and should be said out loud

Photographs **already published** keep their EXIF in R2. This spec stops the
bleeding; it does not clean the wound, and the Worker has no delete route by
design (ENH-11). Anyone who has already shared a tank containing a small photo
has already published whatever that photo carried. Republishing after this ships
uploads a clean derivative, but the old object is still addressable by its key.

Filed as **BUG-20** rather than folded in here, because the fix is a
reconciliation the Worker cannot currently express.

## Requirements touched

- **NFR-04** — the clause this implements, for the first time.
- **NFR-03** — the original is not touched, which is why the strip happens on
  the way out rather than on the way in.
- **FR-A03 / spec 029** — reuses `deriveRenditions`' proven-clean path.
- **New ID claimed:** BUG-20, for the objects already in the bucket.
