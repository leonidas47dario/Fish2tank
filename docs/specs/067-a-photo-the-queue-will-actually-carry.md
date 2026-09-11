# 067 — A photo the queue will actually carry

## What was asked

> "It seems like altho the pictures are populated, the sharing functionality is
> failing now."

then, after spec 054's preview route went live on uat and the card came back
with the tank's name but no image:

> "I don't see the new feature"

and, once the shared page itself was checked:

> "Actually, it's not! My tank photo isn't on the top either! That must be the
> bug?"

Yes. Two independent observations agreed: no `og:image` in the card, and no
hero photo on the page. Both are the same absent field — `tank.photoBlobKey`
was never in the published manifest.

## The problem

Spec 064 stopped publishing originals. `publishableKeyFor` returns the preview
when one exists, and for a photograph that has none — anything whose longest
edge is already under `PREVIEW_EDGE`, or anything captured before spec 036 gave
the tank-photo path its renditions — it strips a copy on the spot and stores it
as the preview.

It stored it **only on this device**.

`runUploadQueue` walks `db.media` filtered by `needsUpload`, which is
`syncState !== 'synced'`, and uploads `transferOrder(media)` for each row it
selects. Every row reaching the strip path is `synced`: publishing gates on the
bytes already being in R2, so a photograph old enough to be shared is one the
queue has finished with. `publishableKeyFor` added a blob to that row and left
the row closed. Nothing would ever carry the new bytes.

So the sequence a keeper actually hits:

1. `publishableKeyFor` strips a copy and returns `blob_stripped`.
2. `headBlob('blob_stripped')` → **not present**, because it never could be.
3. The photograph is dropped from the snapshot, and the keeper is told:
   *"The tank photo has not finished syncing … Sync your photos, then update
   the shared page."*
4. Syncing does nothing to that blob. Updating the shared page runs the same
   three steps again. **The advice cannot be followed**, and the app gives no
   other account of itself.

`publishableKeyFor` is the only place in the app that adds a blob to an
existing media row — every other rendition is written by a capture path, into a
row created `local-draft` in the same transaction. That is why this is the one
instance of the defect rather than a class of them, and why nothing else
exhibited it.

A second, smaller fault sat on top of it. The warning logs
`blobKey: media.originalBlobKey` while `headBlob` had asked about the *preview*,
so the single diagnostic line in the system named an object that was present
and reported it missing. Anyone reading the log would have looked in the wrong
place — which, for four days, is what happened.

## In scope

- Reopen the media row when a copy is stripped, so the upload queue carries it.
- Log the key that was actually checked.

## Out of scope

**Uploading the stripped copy inline so the FIRST publish carries it.** That
would change spec 026's rule — publish a key only once R2 confirms it — which
exists because a key the Worker cannot serve is a torn image on a stranger's
screen. The rule is right; this spec restores the system to obeying it with a
recovery that works, rather than replacing it under time pressure. A keeper's
first share of an un-previewed photo still goes out without it, says so, and
the next one has it. If the extra round trip proves annoying in use, that is a
separate change with its own argument.

**A placeholder image for a tank with no photo.** Spec 054 rejected it
deliberately — a generic picture makes every tank look identical in a thread —
and this defect is not evidence against that call. Falling back to one of the
tank's *own* fish is a real option and is filed as ENH-22, not smuggled in
here.

**Anything already published.** A share made before this fix carries no photo
key and will not grow one on its own. Re-sharing is the fix, and it now works.

## Acceptance criteria

1. After `publishableKeyFor` writes a stripped preview, `needsUpload(row)` is
   `true`.
2. A publish that had to strip warns, publishes without the photo, and leaves
   the row queued; a second publish once the bytes are in R2 carries
   `tank.photoBlobKey`.
3. The original is still untouched (NFR-03) and the stripped copy still carries
   no metadata (NFR-04) — spec 064's criteria, unchanged.
4. The "not in the bucket yet" log names the key that was checked.
5. Both new tests fail against the pre-fix code. Verified: reverting the one
   line fails exactly the two new tests and nothing else.

## Alternatives rejected

**`local-draft` instead of `retry-required`.** The row is not a draft — it is a
synced row that owes the store one more object, which is what the queue's own
failure state already means. `local-draft` would also read, to anyone
inspecting the database, as a photograph that had never been uploaded at all.

**Deriving the strip eagerly for every photo at capture.** It would remove the
case entirely, but it spends CPU and storage on every photograph to serve the
few that are ever shared, and it does nothing for the photographs already on
devices — which is the whole affected population.

**Marking the row unsynced from `publishTank` rather than `publishableKeyFor`.**
The function that writes the blob is the one that owes the queue a reopened
row; splitting them is how the two drifted apart in the first place.

## Requirements touched

- **NFR-04** — EXIF stripping, spec 064. Unchanged in intent; this is the half
  that made it reachable.
- **FR-S05 / spec 026** — a key is published only once confirmed in the bucket.
  Unchanged, and now actually satisfiable.
- **NFR-13** — a log line that names the wrong object is not diagnostics.
