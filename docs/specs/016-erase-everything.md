# 016 — Erase everything, so a backup has somewhere clean to land

## What was asked

> I'd also like a button to clean my profile completely, it will force create
> a local backup, and then ask for consent and clean my entire profile. The
> idea is that i can then reimport a previous cleaner version.

## The problem

There is no way to empty the app. Restore is additive by design — spec 006's
import "adds to what is here and never deletes it", which is the right rule
for a restore and leaves no route to a clean slate. Today the only way to get
one is to clear the browser's site data, which is both drastic and, since
spec 005, wrong: it empties the device and then re-downloads every record
from the cloud on the next login.

## The trap this feature exists to avoid

**Deleting the database is not erasing the profile.**

`holdings`, `residencies`, `specimens` and the rest are all outside
`UNSYNCED_TABLES` (FR-A01), so they sync. Dropping the IndexedDB database
empties this device and leaves the account untouched; the next login pulls
all of it back. To a keeper that is indistinguishable from a wipe that
silently did nothing, which is the DW_SYNC failure in a more expensive place —
they have already been told it is safe to restore over the top.

So this deletes **rows**, while signed in, so the deletions are real writes
that propagate to the account and to every other device. That is what "clean
my entire profile" has to mean once an account exists, and the screen says so
in those words rather than describing the safer case.

## Scope

**In:** clearing every personal table; removing keeper-submitted species and
their profiles; a forced backup ahead of the erase; a typed consent step.

**Out:** a "reset this device only" variant. It is a coherent feature and a
different one — an escape hatch for a confused client rather than a way to
start over — and shipping both at once would put two buttons a mis-tap apart
that differ only in blast radius. Out too: any change to import, which
already restores correctly onto an empty database.

## What is erased, and what is not

Twenty tables are cleared outright: the export's list minus
`species`/`speciesProfiles`, plus the three local-only tables an export
deliberately omits (`blobs`, `draftKeys`, `deletedRecords`).

**The shipped species catalog stays.** It is reference data every keeper
needs, it regenerates from `npm run marts`, and re-seeding 2,176 species after
every erase would be slow and pointless. The exception is a species the keeper
typed in themselves (`origin: 'user-submitted'`), which is their data and goes
with the rest, profile included — leaving it behind would strand a private
label in a table that looks shared.

## The flow, and why three steps

1. **Back up.** The archive is written first, as step one, and a failed or
   cancelled export aborts the whole thing. Asking someone to confirm they
   have a backup asks them to remember; taking one does not.
2. **Consent.** Type the word `ERASE`. Not a second button: the cost of a
   mis-tap here is the entire collection, and the only honest defence is
   making the action impossible to perform by accident.
3. **Erase**, then report the count actually removed.

## Acceptance criteria

1. Nothing is deleted unless `exportArchive` has produced a file. ✅
2. The confirm control is disabled until the keeper types `ERASE`. ✅
3. Every table in `ERASED_TABLES` is empty afterwards. ✅ tested
4. The shipped catalog survives; keeper-submitted species and their profiles
   do not. ✅ tested
5. A table named for erasure but missing from the schema throws rather than
   passing silently — otherwise something personal is left behind. ✅
6. Each table is counted, cleared, then re-counted, and a table that did not
   empty throws. Green means verified. ✅
7. Safe on an already-empty profile, and idempotent. ✅ tested
8. A failure part way through says so, and says the collection may be
   partly gone, rather than reporting a clean failure. ✅
9. The wording changes with sign-in state, because "this browser" and "your
   account, on every device" are very different promises. ✅

## Alternatives rejected

- **`db.delete()`**, or clearing site data. Empties the device, not the
  account. See the trap above.
- **A checkbox saying "I have a backup".** It records a claim rather than
  producing an artefact, and the claim is wrong exactly when it matters.
- **Erasing the shipped catalog too.** Slow, pointless, and it would leave the
  app unable to identify anything until a mart rebuild.
- **Using this to fix the duplicated holdings** (spec 015). It was the first
  instinct behind the request and it loses data: the deduplicated collection
  is larger than any single import run, and the spreadsheet carries none of
  the specimens, media, encounters, assessments or identifications.

## Revision, 2026-08-30: the backup gets a name you can identify

> I'd also like an option to clean my profile which first records a back up
> zip with timestamp and username and then cleans my profile to a clean slate.

The flow above already took the backup first. What it did not do was name it
usefully: `archiveFilename` carried the **date alone**, so
`fish2tank-export-2026-08-30.zip` was the name whether it came from an idle
manual export or from the forced backup a minute before an erase, and whoever
it belonged to. Two on one day and the browser quietly appends `(1)` — leaving
the file you need to restore from as the one you cannot identify, at the exact
moment identifying it matters most.

Now `fish2tank-backup-<account>-<YYYY-MM-DD-HHMM>.zip`.

Three calls worth recording, because each could reasonably have gone the other
way:

- **UTC, to the minute.** It matches `manifest.exportedAt` inside the archive,
  so the name and the contents agree. A local-time name beside a UTC manifest
  reads like two different backups.
- **The local part of the email, not the whole address.** Enough to tell two
  accounts apart, and a backup is a file people hand around when something has
  gone wrong; a full address in the filename travels further than the person
  who typed it expected.
- **Signed out, the name is just the timestamp.** No placeholder, no
  `unknown` — there is genuinely no account, and saying so by omission beats
  inventing a word for it.

The account is read at the moment of export rather than held in state,
because an export is often the last thing that happens before an erase and a
stale name on that file is unrecoverable. Six tests, including the
same-day collision that motivated this and a display name of `???` that must
not yield a bare `--.zip`.

## Requirements touched

FR-A01 (which tables sync, and therefore what a deletion reaches), NFR-08
(backup and restore), NFR-13 (say what you are about to do, out loud).
Claims a new ID: **FR-A10**, erase the profile.
