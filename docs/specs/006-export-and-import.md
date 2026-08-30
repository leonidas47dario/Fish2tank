# 006 - Export and import

**Status:** designed, being built
**Date:** 2026-08-29
**Touches:** NFR-02 (local-first), NFR-03 (originals are never altered), ENH-04 (IndexedDB can be evicted), spec 005 FR-A01 (the personal-vs-derived data boundary).
**Claims:** FR-A08 (export the collection to a portable archive), FR-A09 (import one back, idempotently).
**Introduces:** a manifest that an import refuses to act on when it disagrees with the archive.

---

## What was asked

Verbatim:

> "fine, I am okay with skipping google and use username + password for now
> actually, would that work? the key is to build the profile storage, which is
> what matters. I also would need a plan to export current info so I can import
> it when a real account is created."

**Username and password was answered, not built.** Without a backend it stores
no account and moves no data; a credential held in IndexedDB is a lock on a
door standing in a field, and anyone with the unlocked device reads past it.
Building it would have looked like progress and delivered none. Recorded here
because the ask says otherwise and a future reader will wonder.

What survives from the ask is the second half, and it is the better half.

## The problem behind it

Ryan framed export as the on-ramp to a future cloud account. It is that. It is
also something more urgent that nobody had written down as a priority:

**There is currently no backup of anything.** The entire collection lives in
one browser's IndexedDB. `ENH-04` has been open since before this session,
noting that `navigator.storage.persist()` was never called, which means Safari
can evict the whole store after roughly seven days on a non-installed site. No
warning, no recovery, no copy anywhere.

So this is not migration plumbing that happens to be useful. It is the thing
standing between 136 fish, six tanks and every photo and a browser cache
decision. That is why it is worth building before sync rather than after.

## Decisions

| Question | Answer | Why |
|---|---|---|
| Format | A single `.zip` | Chosen by Ryan for portability over the streaming directory export. One file drops into Drive or an email. |
| Encryption | None | Consistent with the cloud decision in spec 005, and keeps the archive readable and repairable. A passphrase that is forgotten makes a backup unrecoverable, which is a bad property for a fallback. |
| Compression | **Stored, not deflated**, for media | JPEG and MP4 are already compressed. Deflating them costs CPU for approximately no saving. Records are deflated, where it does help. |
| Memory | Streamed via `fflate`, accumulated into a `Blob` | Ryan accepted the zip knowing it has a ceiling the directory export does not. Streaming into a Blob rather than one `ArrayBuffer` raises that ceiling substantially, because a browser can back a Blob with disk. |

## The archive

```
manifest.json      what this archive claims to contain
records.json       every personal table
media/<blobKey>    original bytes, one file per blob, stored uncompressed
```

`manifest.json` carries the schema version, when it was written, the app build
that wrote it, a row count per table, and the media count and total bytes.

## FR-A08 - What gets exported

The same personal-versus-derived boundary as spec 005 FR-A01, **with one
correction that boundary gets wrong for backups.**

Exported: `users`, `places`, `specimens`, `encounters`, `media`,
`identifications`, `priceObservations`, `raritySnapshots`, `dreamList`,
`aquariums`, `holdings`, `residencies`, `lifeEvents`, `assessments`,
`memorials`, `keeperPrinciples`, `cardPrefs`, and every blob referenced by an
exported `media` row.

Not exported: `draftKeys` (transient, per-device retry bookkeeping), and the
seeded catalog, which regenerates from `npm run marts` and would add 3.8 MB of
derived data to every backup.

**The correction.** `species` and `speciesProfiles` are excluded from *sync*
because they are ETL output. But a keeper can now type in a species the
catalog lacks, and those rows carry `origin: 'user-submitted'`. They are
personal data that exists nowhere else. Excluding the whole table would drop
them silently and leave every specimen pointing at them orphaned on restore.

So: export `species` rows where `origin === 'user-submitted'`, and the
`speciesProfiles` belonging to them. Catalog rows stay out, because the
importing device already has them.

## FR-A09 - What import guarantees

1. **Idempotent.** Restores key on the IDs already in the archive, so importing
   the same file twice leaves one copy of everything, not two. This is where
   restores usually go wrong, and a duplicated 61-row inventory is a bad way
   to find out.
2. **Verified before it acts.** Import reads `manifest.json`, counts what the
   archive actually contains, and **refuses the whole file** if they disagree.
   A half-restore over a live database is worse than a refusal.
3. **Additive, never destructive.** Import never deletes a local row the
   archive does not mention. Restoring a six-month-old backup must not remove
   what has happened since.
4. **Originals arrive byte-identical** (NFR-03). Media bytes are stored, not
   transformed, in both directions.
5. **Reports what it did**, per table, in the UI and the log. "Imported" with
   no numbers is the status field that lies.

## A bug this found, and the fix it forced

Building import surfaced a defect that predates it, in the path that matters
most. Measured in a real browser, not reasoned about:

1. Wipe IndexedDB, the way a Safari eviction does (ENH-04).
2. Reopen the app. `bootstrap()` sees `holdings.count() === 0` and re-seeds the
   61-row inventory.
3. Restore a backup.
4. **122 holdings.**

Import was not duplicating its own rows. `importInventory()` minted
`newId('hold')`, a fresh random UUID, on every run, so the re-seeded 61 carried
different ids from the exported 61 and the restore landed beside them instead
of on top. Seeding was never idempotent; nothing had made that visible before,
because nothing had ever re-seeded a database that already had a history.

**Fix:** seeded ids are derived from the row's own content
(`stableId()` in `inventory-import.ts`, FNV-1a, no dependency). The same sheet
yields the same ids every time, so a restore overwrites the re-seed.
`applyInventoryImport` also moves from `bulkAdd` to `bulkPut`, so re-importing
the same spreadsheet updates 61 rows rather than either duplicating them or
throwing a constraint error.

This is a strictly better property for the inventory import generally, not
only for restores: importing the same file twice was previously a silent
duplication.

## FR-A10 - The app stops seeding somebody's collection

Ryan's follow-up, once import worked:

> "so I think this also means that we would not be needing to seed the tank and
> inventory, since the import should take care of all those right?"

Right, and for a stronger reason than redundancy. `bootstrap()` seeded five
things; four of them were his personal data: six tanks, a 61-row inventory, his
local fish store, and his Oscar. Three separate problems:

1. **Redundant.** Exports exist now. A fresh device should restore, not
   fabricate.
2. **It broke restores.** It is the direct cause of the 122-holdings bug above.
   Removing the auto-seed removes the whole class, not just the symptom the
   stable-id fix patched.
3. **It is somebody else's data.** The moment a second keeper opens the app,
   they get Ryan's tanks and Ryan's fish. That is a bug, not a demo.

A fourth reason applies to what comes next: a device that both seeds and syncs
would build local rows alongside the incoming ones, so this had to go before
Dexie Cloud arrives regardless.

The species catalog stays. It is reference data every keeper needs.

**Where the sample collection went.** `src/data/seed/fixtures/smoke-collection.zip`,
generated by `npm run fixture:smoke` from the same `STARTER_TANKS` and CSV the
seeder used. The smoke test restores it through the real import code, chosen
over a "Load sample data" button so that every CI run also proves backup and
restore still work.

Records only: the smoke test creates its own Panther through the catch flow, so
a seeded specimen would collide with it, and the media round trip is already
covered byte-for-byte by unit tests.

**Existing devices are untouched.** Seeding only ever ran against an empty
table, so removing it neither deletes nor renames anything already stored. The
tank display names applied by the old `updateSeededTanks` pass are already
persisted on Ryan's devices and stay there.

## Two things this uncovered about verification itself

Worth recording because both made tests lie.

**The smoke test was running against another session's code.** `vite preview`
defaults to port 4173, and a concurrent session had one running from
`/tmp/f2t-drawer2`. Every `npm run smoke` in this worktree connected to that
server, so three "smoke passed, no console errors" results verified somebody
else's build. Run smoke against an explicit free port
(`BASE_URL=http://localhost:4188 npm run smoke`) when more than one session is
active.

**The smoke test was already broken on `uat`.** `PriceForm` lost its
member-price input, and `scripts/smoke.mjs` still filled `#member`. It only
kept passing because of the port collision above. Fixed here, incidentally,
because it blocked verifying anything else.

## Out of scope

- Any network, account, or sync. This is deliberately the offline half.
- Merge conflict resolution. Same ID means same record; last import wins for
  that row. Real conflict handling belongs with sync, not here.
- Selective or partial export.
- Scheduled or automatic backups. Manual first; automation once the manual
  path is proven.
- Calling `navigator.storage.persist()`. It belongs with this problem and is
  still filed as ENH-04, but it is a separate one-line change with its own
  permission prompt, and bundling it here would hide it.

## Acceptance criteria

1. Export produces one `.zip` containing `manifest.json`, `records.json`, and
   one file per referenced blob.
2. Media bytes round-trip byte-identical through export and import.
3. Importing an archive into an empty database reproduces every exported row.
4. Importing the same archive twice produces the same row counts as importing
   it once.
5. An archive whose manifest disagrees with its contents is rejected whole,
   with the mismatch named, and nothing is written.
6. Import does not delete local rows absent from the archive.
7. A user-submitted species survives the round trip; catalog species are not
   in the archive.
8. Export and import are reachable from Settings and report per-table counts.
