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
