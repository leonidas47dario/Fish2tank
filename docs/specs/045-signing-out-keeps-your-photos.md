# 045 — Signing out keeps your photographs

**Status:** implemented.
**Date:** 2026-09-03.
**Touches:** NFR-03 (the original is never lost), FR-A01, FR-S01.
**Fixes:** BUG-10, and the reachable half of BUG-12.

---

## What was filed

> **Signing out deletes every photo on the device.** `_logout()` in
> `dexie-cloud-addon` clears every Dexie table except `$jobs`, and that includes
> `blobs` — which is in `UNSYNCED_TABLES`, so an original that media sync has
> not yet uploaded to R2 exists nowhere else.

And, immediately above the button:

> Signing out leaves this device's copy exactly where it is. Nothing is deleted.

That sentence is false, and it is the reassurance somebody reads in the second
before they press.

## Why this is the worst shape a bug can have

Every other data-loss defect this project has shipped announced itself. This one
is invited: the app tells you it is safe, you believe it because it is written
down, and the photographs that go are precisely the ones that existed in **no
other place** — the ones sync had not finished with.

NFR-03 says the original is the one thing that must never be lost. A signed-out
device with an empty `blobs` table has lost every original that had not reached
R2, and there is nothing to restore from.

## The gate, and why it is a gate rather than a warning

Two things must be true before a sign-out is safe:

1. **No photograph still owes its bytes to R2.** `photoSyncWork(db).pending` is
   exactly that count — "rows this device still owes bytes for" — and it is
   already computed for the sync indicator, so this reuses an answer the app has
   rather than inventing a second one.
2. **The record sync has settled.** `shares` is deliberately synced (see
   `db.ts`), so a published page survives a sign-out *once the row has reached
   the account*. Before that it does not, and BUG-12 named the consequence:
   the token is the only thing that can revoke the page, so a page whose row is
   lost stays on the internet with nothing able to take it down. **A photo lost
   is a photo; a token lost is a page nobody can take down.**

When either fails, sign-out is **refused**, not warned about. That follows the
precedent this repo has already set twice: spec 016 aborts an erase rather than
erasing without a backup, and spec 028 aborts entirely if any shared page
survives. Warning-and-proceeding is how the data goes.

### Refusing is not enough on its own

A gate with no way through is a trap — a keeper offline in a fish shop would be
unable to sign out at all, and would have no idea why.

So the refusal carries the way out, and it is the same one spec 016 uses:
**take the backup, then sign out.** Once the archive is on the keeper's disk the
photographs exist somewhere other than a table `_logout` is about to clear, and
the objection is answered rather than overridden.

The backup path is `exportArchive`, unchanged and already used by Settings and
the join gate. Nothing new writes files.

## What the panel says now

The false sentence is replaced by one that is true in both states, because a
reassurance that is only sometimes right is worse than none:

- settled: *"Your photographs are all backed up to your account, so signing out
  leaves nothing behind."*
- not settled: the count, what it means, and the two ways forward.

## Deliberately not done

- **Blocking sign-out on `missing`.** That counts photographs this device has
  not yet *downloaded*, which by definition exist elsewhere. Losing a copy you
  never had is not losing anything.
- **Revoking shares on sign-out.** Spec 028 does that for erase, where the
  keeper asked for everything to go. Signing out is not that request, and
  taking somebody's published pages down because they signed out on a phone
  would be a worse surprise than the one this fixes.
- **Uploading on demand from the gate.** Tempting, and it is the media queue's
  job; a second uploader racing it is how the queue's own invariants break.
  The queue already runs — the honest instruction is to wait for it or take the
  backup.

## How this was verified, and the honest limit on it

The rule is a pure function with ten tests, so refusal, both blockers, the
unknown-phase case and the backup route are all guarded without a browser.

The wiring needed a browser, and **the signed-in branch cannot be reached in
developer mode** — developer mode is signed out by definition, so the first run
found no sign-out button at all and proved nothing. It was checked instead
against a **scratch build with `signedIn` forced true**, discarded immediately
afterwards; the working tree carries no trace of it and the shipped build is the
real one.

| | |
|---|---|
| one unsynced photo — sign-out button | **disabled** |
| the refusal shown | *"1 photograph is still only on this device, and your records have not finished syncing…"* |
| backup offered | yes |
| "Nothing is deleted" still on the page | **no** |
| after taking the backup | archive `fish2tank-backup-2026-09-04-0021.zip` downloaded, **sign-out enabled** |
| the line it then shows | *"Backed up. 1 photograph is only in that archive, so keep the file."* |

What this does **not** prove is the behaviour against a real signed-in Dexie
Cloud session, because no account can be signed into from here. The gate reads
`db.cloud.syncState.phase` and `photoSyncWork().pending`, both of which the
panel already used before this change — but that is an argument, not a
measurement, and it is recorded as one.

## Acceptance criteria

1. Sign-out is refused while any photograph still owes bytes to R2. ✅
2. Sign-out is refused while record sync has not settled. ✅
3. The refusal says how many, and offers a backup. ✅
4. After a successful backup, sign-out proceeds. ✅ (browser)
5. A settled device signs out with no extra step. ✅
6. No screen claims nothing is deleted when something would be. ✅
