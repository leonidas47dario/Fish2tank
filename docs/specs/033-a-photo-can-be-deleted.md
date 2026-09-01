# 033 — A photo can be deleted

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-J01 / NFR-03 (the original is the only copy), BUG-06 / spec 012 (the sweep), spec 029 (which gave a photo two more blobs).

---

## What was asked

> right now once a photo is uploaded can't be deleted is a little annoying

Accurate, and it was never built rather than broken. Four places in
`repositories.ts` delete a `media` row — replacing a tank photo, clearing a
tank photo, and the catch cascade — and none of them is *"remove this
photograph from this fish."* A keeper could add photos and never take one back.

## The rules this has to get right

### Detach, never destroy, when another fish still has it

`Media.specimenIds` is a **list** because one picture can show several fish
(section 9). Deleting "this photo" from one record must not take it from the
others. The catch cascade already worked this way, in a comment that reads
*"Another catch still needs this photo. Detach, never destroy."* This is the
same rule at the level a keeper actually acts on.

### The original is the only copy, so the caller must confirm

NFR-03 keeps one untouched original and nothing else. There is no bin and no
undo. This is the one destructive act in the photo flow, so the UI asks first
and says why: *"The original is the only copy — there is no undo."*

The control sits **under the photo it acts on**, not on each thumbnail. A
delete button on every strip item is a row of small destructive targets on a
phone, which is exactly where this app is used.

### A tank photo is refused, not silently mishandled

`clearTankPhoto` owns that one, because it also has to clear
`aquarium.photoMediaId`. Deleting the row from here would leave a tank pointing
at nothing, so this throws and says where to go instead.

### Every blob, not just the original

The four older sites deleted `originalBlobKey` alone. That was harmless while
nothing else existed — **spec 029 changed it three weeks later in the same
session**, and from then on every delete stranded a preview and a thumbnail for
the orphan sweep to find eventually.

Not a leak, because spec 012's sweep does collect them. But a delete that
leaves work for a later sweep is a delete that has not finished, so
`blobKeysOf()` now collects all three and all five sites use it.

### A stale card preference is cleared

`cardPrefs.preferredMediaId` can name the deleted photo. `chooseArt` already
falls back to the newest, so this is tidiness rather than a crash — but a
stored preference naming a row that no longer exists is a lie the next reader
has to work out.

## What this does not reach, stated because it looks like it should

- **The copy in R2.** ENH-11, still open: a swept blob leaves its object
  behind. The Worker has no delete route on purpose.
- **Other devices' bytes.** The `media` row is synced, so its deletion travels,
  and each device's own sweep collects the blobs locally. That is exactly the
  mechanism BUG-06 built.
- **A shared page, immediately.** Removing a photo changes the fingerprint, so
  the page republishes and the key drops out of `allowedBlobKeys`, after which
  the Worker refuses to serve it. **Until that republish lands, a guest holding
  the link can still see it.** Not a leak of something private — they could
  already see it — but the gap between "deleted here" and "gone from there" is
  real and should not be described as instant.

## Acceptance criteria

1. A photo on a record can be deleted, behind a confirmation. ✅
2. It takes the original, the preview and the thumbnail. ✅
3. A photo attached to another fish is detached, not destroyed. ✅
4. A tank photo is refused, with a message pointing at the tank. ✅
5. A card preference naming it is cleared. ✅
6. Deleting something already gone is a no-op, not an error. ✅
7. The four older delete sites clean up all three blobs too. ✅
8. `vitest run` and `npm run build` both green. ✅
