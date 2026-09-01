# 028 — Erase takes your shared pages down with it

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** NFR-04 (publication is the thing governed), FR-S05 (stop sharing), and spec 016's erase flow.
**Closes:** BUG-11.

---

## What was asked

Nothing, directly. This is BUG-11, filed while merging spec 023 into a `uat`
that already carried spec 016, and knowingly shipped to production in the
promotion of 2026-09-01 after being raised twice and accepted.

## The bug

`ERASED_TABLES` did not list `shares`, and nothing in the erase path revoked.
So Settings → **Erase everything** emptied the collection, reported success,
and every published page kept serving.

The rows survived, so a keeper *could* still revoke — but only if they knew
to, having just been told everything was gone. There is no unusual sequence
here: share a tank, later erase, and a stranger's link still works.

**Spec 026 made it worse.** A shared page used to carry one photo of a tank.
It now carries a photograph of every photographed fish in it. The gap between
"I erased everything" and what is actually still public widened at exactly the
moment the contents got more personal.

## The rule

**A `shares` row must not be destroyed while the page it names is live.**

The row holds the token, the token is the only way to revoke, and a published
page outlives the device that made it. Destroy the row first and the page
serves forever with nothing left that can turn it off — which is strictly
worse than the bug being fixed, because BUG-11 at least leaves a recovery
path.

Two places destroy those rows, so the rule lives in `revokeEveryShare` rather
than at either call site:

- `eraseEverything`, addressed here.
- Spec 022's join gate, which discards a never-synced device's records. That
  is **BUG-12** and is deliberately not in this PR — it needs its own decision
  about whether the backup archive should carry live tokens, and bundling it
  here would hide that question inside a bug fix.

## The change

### Revoke first, and abort if anything survives

The precedent is one step up in the same flow. Spec 016 made the backup step
one, and a failed export aborts the whole thing rather than erasing anyway —
because the dangerous outcome is not the failure, it is a screen reporting
success while something the keeper believes is gone is still out there. A
published page is exactly that.

So: revoke every share, and if any could not be taken down, **erase nothing**
and name the tanks that are still public.

Aborting rather than erasing-and-warning is the deliberate part. Clearing
`shares` takes the token with it, so a page left up here could never be
revoked from the app again. A keeper who is offline can reconnect and try
again, or stop sharing each tank by hand first — both recoverable. The other
way round is not.

### `shares` joins `ERASED_TABLES`

Only safe *because* the revoke runs first, and the comment there says so. A
test asserts the membership, so the coupling is visible at the place someone
would break it.

### Failures are reported by name, not by id

`revokeEveryShare` collects failures instead of throwing on the first: a
keeper with three shared tanks whose second revoke fails is better served by
two dead links and a precise list than by one dead link and an exception. It
looks up the aquarium's name, because an id is not something anyone holding a
phone can act on.

The sweep is serial, unlike the parallel HEADs at publish time. Each call is a
DELETE against a different token and a partial failure has to be attributable
to a tank; a `Promise.all` that rejects tells a keeper something is still
public without telling them what.

## Alternatives rejected

- **Erase, then warn.** Reported as the friendlier option when BUG-11 was
  filed. It is the one that cannot be undone: the warning names pages the app
  can no longer revoke.
- **Leave `shares` out of `ERASED_TABLES` and revoke nothing.** The status quo.
  "Everything" would go on not meaning everything, and the rows would survive
  an erase that claims to have removed the collection.
- **Revoke in the background after erasing.** No way to report the failure to
  someone whose app has just been emptied, and the tokens are already gone.

## Acceptance criteria

1. Erasing with published tanks takes every page down first. ✅
2. If any revoke fails, nothing is erased, and the message names the tanks
   still public and why. ✅
3. `shares` is cleared once revocation succeeded. ✅
4. Nothing published survives a successful erase. ✅
5. Failures are reported by tank name, not aquarium id. ✅
6. A signed-out or offline keeper gets a failure, not a silent skip. ✅
7. `vitest run` and `npm run build` both green. ✅

## Not done here

BUG-12, above. And the erase flow still cannot revoke a share published by a
*different* device that has not synced its `shares` row to this one — the
account's rows arrive with sync, so this is bounded by the same sync the rest
of the app depends on, but it is not a guarantee and should not be described
as one.
