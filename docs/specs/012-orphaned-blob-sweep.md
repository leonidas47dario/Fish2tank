# 012 — Bytes with nothing pointing at them get swept up

## What was asked

> Can you look at Bug-06? And fix it into UAT too?

BUG-06, as captured on 2026-08-30:

> Deleting a photo on a device that never had the bytes deletes the record
> everywhere. […] The `media` row is deleted and **syncs**, while the
> accompanying `blobs.delete` is a local no-op because the bytes were never
> there. The photo disappears from the first device too, and its bytes are
> stranded in that device's `blobs` table with nothing referencing them. […]
> Needs a rule for deleting media you do not have locally — most likely
> refuse, or tombstone and let the holding device do it.

## The problem

`media` syncs; `blobs` does not. That is FR-A01's data boundary and it is
correct — the megabytes go to R2, not through Dexie Cloud. But it means a
delete is only half-delivered.

Phone takes a photo: a `media` row *and* a `blobs` row, written together.
Tablet syncs and gets the `media` row only. On the tablet you clear the tank
photo. Four call sites do the same pair of writes:

```
media.delete(id)                  // syncs — reaches the phone
blobs.delete(originalBlobKey)     // local no-op — the tablet never had them
```

The phone loses the record and keeps the bytes, forever, with nothing in the
database referencing them. Nothing ever collects them: there is no code path
in the app that looks at `blobs` and asks whether anything still wants a key.

Two things follow that the bug report did not name:

- **It is not only a cross-device problem.** All four sites delete
  `originalBlobKey` and none of them touch `previewBlobKey` or
  `thumbnailBlobKey`. Replacing a tank photo on the device that owns it
  already strands any derived blobs, single-device, today.
- **Bytes are stranded on real devices right now.** Whatever rule we adopt for
  future deletes does nothing about those, so the fix has to be able to look
  at the state of the world rather than only at new events.

## The fix, and why not the two the bug report suggested

**Sweep `blobs` for keys no `media` row references, and delete them.**

The bug report proposed *refuse the delete*, or *tombstone it and let the
holding device act*. Both were considered and rejected:

- **Refuse.** "You can't remove this photo because you're on your tablet" is a
  worse product than the leak. The delete is a legitimate thing the person
  meant to do, and it syncs correctly — the record genuinely should go.
- **Tombstone.** `deletedRecords` is in `UNSYNCED_TABLES`, so a tombstone
  written on the tablet never reaches the phone. Making it sync is a real
  change to the data boundary with its own consequences (a tombstone from one
  device suppressing another device's seeders), and it would still not touch
  the bytes already stranded.

The sweep needs neither, because **the deletion of the `media` row is already
the tombstone** — Dexie Cloud delivers it for free, and "no row points at this
key" is a fact any device can check locally at any time. It is also the only
one of the three that cleans up what is already stranded, and the only one
that catches the single-device preview/thumbnail case.

The invariant it rests on, checked against every writer: **a `blobs` row is
never created except alongside a `media` row that references it, in the same
transaction.** `createCatchDraft`, `addPhotos`, `setTankPhoto`, the import restore
(`portability/import.ts`) and the media download queue are the five writers,
and all five do this.

### The guard, and the leak it deliberately accepts

A sweep that reads an empty `media` table concludes that every byte on the
device is garbage. That must never happen, so **the sweep does nothing when
`media` is empty.** An empty `media` table beside a non-empty `blobs` table is
far more likely "the records have not arrived yet" than "every photo was
deleted".

The cost is explicit: someone who deletes every single photo keeps the bytes
until they add another one. That is a leak, it is bounded, and it is the safe
direction of a trade whose other side is deleting originals that no copy
exists of. NFR-03 says the local original is the record.

## In scope

- `sweepOrphanedBlobs()` in `src/data/blob-sweep.ts` — pure over
  `(database)`, returns what it examined, removed and reclaimed.
- Reuses `referencedBlobKeys()` from `portability/export.ts`, which already
  answers "every blob key a set of media rows points at" and already covers
  all three key fields. A second copy of that list is how the two drift.
- Called at start-up (not awaited, never blocking first paint) and at the end
  of a media sync run.
- Reports **bytes** reclaimed, not only a count, and measures them rather than
  estimating: orphan rows are read in small batches so the number is real
  without holding every original in memory at once.

## Out of scope

- **Deleting the object from R2.** The Worker has no delete route
  (`/presign/delete` is explicitly a 404), and remote cleanup is a different
  problem with its own safety question: an object is shared across devices,
  and "no local row references it" is not evidence that no device does.
  Backlogged.
- **Warning that you are deleting a photo you cannot see.** A real hazard on a
  device that holds no bytes, and it largely evaporates once media sync works
  and the tablet has downloaded the picture. Not this change.
- Changing `UNSYNCED_TABLES`. See above.

## Acceptance criteria

1. A blob whose `media` row was deleted elsewhere is gone after a sweep, and
   the sweep reports its bytes.
2. A blob referenced by any of `originalBlobKey`, `previewBlobKey` or
   `thumbnailBlobKey` is never removed.
3. With `media` empty, the sweep removes nothing and says why.
4. A sweep on a device with nothing to collect is a no-op that reports zero.
5. Sweeping twice removes nothing the second time.
6. A failing sweep never breaks start-up or a media sync run.

## Verified, not just tested

Six unit tests, and two of them were confirmed to fail against the mistakes
they guard (looking at `originalBlobKey` alone; dropping the empty-`media`
guard) rather than being assumed to have teeth.

Then driven in a real browser against the production build, because a
start-up path is exactly where a green test suite is least convincing: an
orphan blob and a referenced blob were planted straight into IndexedDB, the
page reloaded, and the app logged

```
[sync] swept orphaned blobs {examined: 2, removed: 1, bytesReclaimed: 4096}
```

leaving `blob_drive_kept` and collecting `blob_drive_orphan`.

## Requirements touched

- FR-A01 (what never leaves the device), FR-A03 (media sync), NFR-03 (the
  local original is the record).
