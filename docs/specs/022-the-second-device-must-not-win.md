# 022 — The second device must not win

**Claims:** BUG-08 (a device joining an account overwrites it), FR-A11 (the
gate asks which copy is the real one), NFR-13 (a sync is not complete until it
is verified).

## What was asked

> I have noticed a bug repeatedly. it seems like local files would override
> cloud files. when user logs in fresh, it should always pull the latest from
> cloud and discard local data, rather than treating local data as source of
> truth and pushing it into cloud. I have been losing changes to the tank due
> to this.

And, when asked which device it happens on: **a second device or browser** —
one that already had the app installed before sync existed.

## The problem

The behaviour is real, it is Dexie Cloud's, and it is not configurable.

`listSyncifiedChanges()` in `dexie-cloud-addon@4.4.14` builds, for every table
not listed in the persisted `syncState.syncedTables`, one mutation of type
`upsert` whose `values` are **every local row in that table**. That goes to the
server before anything is pulled. `filterServerChangesThroughAddedClientChanges()`
then removes the server's own changes for those same keys from what is applied
back locally. So on the first sync after a login, for any primary key present
both locally and in the cloud, the local row replaces the cloud row and the
cloud row is never seen. There is no option that reverses this, and there is no
merge: it is a whole-object replace.

That is the correct behaviour for the case spec 005 FR-A06 measured — a device
carrying the only copy, claiming it into an empty account. It is the wrong
behaviour for the case nobody measured: a device carrying a **stale** copy,
joining an account that already holds a newer one.

### Why it lands on tanks specifically

Most records carry random ids (`newId()` is `crypto.randomUUID`), so two
independently seeded devices produce two disjoint sets and the merge shows up
as duplicates. Tanks do not. `STARTER_TANKS` ships six literal primary keys —
`tank_75g`, `tank_breeder_tote`, `tank_quarantine`, `tank_bass_tote`,
`tank_mini`, `tank_predator` — and `STARTER_PLACE` ships a seventh,
`place_aquarium_adventure`. `LOCAL_PROFILE_ID` is an eighth, `user_local`.
Every device that ever ran the old `bootstrap()` holds those same keys with its
own values.

Verified against both live cloud databases on 2026-08-30: all six tanks are
still stored under the hardcoded ids, all with `createdAt` = `SEEDED_AT`.

So the same event produces two different symptoms, and only one of them is
visible:

| Id shape | What happens on the joining device's first sync | Visible? |
|---|---|---|
| Random UUID (holdings, specimens, encounters) | Both rows survive side by side | Yes — duplicates |
| Hardcoded (`tank_*`, `place_*`, `user_local`) | Stale row silently replaces the newer one | No |

**Spec 015 fixed the visible half and declared the cause extinct.** It
diagnosed 176 holdings as "first-run seeding on three separate local
databases", repaired them, and concluded that because `bootstrap()` no longer
seeds a collection, "no code change is required to prevent recurrence". That
conclusion is right about the seeding and wrong about the merge. The three
local databases it identified still exist on Ryan's devices, each still holding
its own `tank_75g`, and each one still overwrites the account's six tanks the
next time it signs in. The duplicate holdings were the loud half of a two-sided
event; the lost tank edits are the quiet half, and they are still happening.

### The app also manufactures a colliding row while logged out

`ThemeProvider` is mounted above `AuthGate` in `main.tsx`, and its first effect
calls `loadProfile()`, which does `users.put({id: 'user_local', settings:
DEFAULT_SETTINGS})` when the row is absent. A signed-out device therefore
fabricates a default profile under a fixed id before anyone has signed in, and
the first sync pushes it over the account's real one. This is the same bug in
miniature, it fires on every clean device, and left alone it would make the
gate below cry wolf about "1 record" on a device that has nothing.

## What this changes

### FR-A11 — the gate asks which copy is the real one

When the sign-in gate is about to log in, it counts the rows this device would
push up: the tables `db.cloud.schema` marks for sync, minus those already
listed in `db.cloud.persistedSyncState.syncedTables`. That set is exactly what
`getTablesToSyncify()` computes, read from the addon's own public API rather
than guessed at.

**If the count is zero, nothing changes.** Signing in works exactly as it does
today. That is the normal path on a clean device and on any device that has
synced before, and it must stay a single button.

If the count is above zero, the gate says so with the number and offers two
routes:

- **Use my account's copy** (default). Takes a backup archive first, refuses to
  continue if the backup fails, then clears this device's synced tables and
  signs in. With nothing local to claim, the first sync is a pure pull.
- **Keep what is on this device.** Signs in exactly as today, and says plainly
  that this device's records will replace the account's where the two disagree.

Not a silent discard, which is what the literal request asks for, because a
silent discard would have destroyed the original 138-row collection during the
spec 005 Release 2 cutover, and would destroy a catch logged on a signed-out
device in developer mode today. The one case where local really is the only
copy is indistinguishable from the failure case without asking.

Three rules the clearing has to obey:

1. **Only tables marked for sync.** `blobs` is not one of them, and it holds
   photo bytes that may exist nowhere else until media sync has run. Clearing
   it would be the worst outcome in the app (NFR-03). Same for `draftKeys`,
   `species`, `speciesProfiles` and `deletedRecords`.
2. **Change tracking off while clearing.** A plain `table.clear()` records
   delete mutations, and `listClientChanges()` replays every recorded mutation
   at the next sync with no filter on which user recorded it. Clearing without
   `tx.idbtrans.disableChangeTracking = true` would not avoid the overwrite, it
   would turn it into a **deletion of the account's records**. The addon sets
   this same flag in its own `_logout()`.
3. **Count afterwards and throw if anything survived.** A partial clear leaves
   a subset of stale rows to be claimed, which is the original bug with a
   smaller blast radius and a success message on top.

### The profile is no longer created before login

`ThemeProvider` switches to a read-only `readProfile()` that returns the stored
row or the defaults without writing. The row is still created on the first
actual settings change, where `updateSettings()` already calls `loadProfile()`.
A signed-out device now writes nothing at all.

## Out of scope

- **Repairing what is already lost.** Overwritten rows are gone; the previous
  values were never anywhere else. Both cloud databases were read on
  2026-08-30 and both currently hold Ryan's own tank names, so there is nothing
  identifiable to repair. Filed rather than guessed at.
- **`tank_75g` has lost its `dimensions` and `stockingState`**, which the seed
  defines and both cloud databases now lack. `TankForm.save()` writes both as
  `undefined` when its inputs are blank and Dexie deletes a property given
  `undefined`, so this may be an unrelated edit path rather than a sync loss.
  Filed as BUG-09.
- **Signing out deletes every photo on the device.** `_logout()` clears every
  Dexie table except `$jobs`, which includes `blobs` — and `blobs` is unsynced,
  so an original that media sync has not yet uploaded is gone for good. The
  Account panel says "Signing out leaves this device's copy exactly where it
  is. Nothing is deleted." That sentence is false today. Filed as BUG-10; it
  needs its own answer (block sign-out until media sync is clean, or back up
  first) and bundling it here would hide it.

## Acceptance criteria

1. `tablesThatWouldSyncUp()` is a pure function of (cloud schema, synced table
   list) and returns exactly the tables the addon would syncify.
2. A device with no unsynced tables shows the plain single-button gate.
3. A device holding local rows in unsynced tables shows the count and the two
   routes, with "use my account's copy" as the default.
4. Choosing the account's copy produces a downloaded backup file before
   anything is cleared, and clears nothing if the export throws.
5. Clearing empties every synced table, leaves `blobs`, `draftKeys`, `species`,
   `speciesProfiles` and `deletedRecords` untouched, and throws rather than
   reporting success if any table still holds rows.
6. Clearing records no mutations, proven by asserting the addon's
   `disableChangeTracking` flag is set on the transaction.
7. A signed-out device does not create `user_local`.

## Alternatives rejected

| Option | Why not |
|---|---|
| **Always discard local on login, no prompt** | What was literally asked, and it destroys the only copy in the one case that matters. The first device to ever sign in has a populated local database and an empty account; this would empty it into the void. |
| **Never let a signed-out device hold records** — clear at the gate unconditionally | Removes the prompt but also removes developer mode's usefulness and still faces the first-device case, since the pre-sync database is exactly a signed-out device holding records. |
| **Detect an empty account and only claim then** | The right rule in principle, and unreachable in practice: the addon triggers its own sync inside `login()`, so there is no window between having a token and the syncification going out. |
| **Give the tanks random ids and migrate** | Fixes the collision for tanks and leaves `place_aquarium_adventure`, `user_local` and every future fixed id. It also does not help the devices already carrying the old keys, which is the whole problem. |
| **Ask Dexie Cloud for a pull-first option** | Correct upstream fix, wrong timescale. Worth filing; not worth waiting for while records are being lost. |
