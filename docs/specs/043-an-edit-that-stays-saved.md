# 043 — An edit that stays saved

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** FR-C03 (correct the record), FR-A06, P6.
**Fixes:** BUG-16, reported against spec 041.

---

## What was reported

> I think the bug persists. When I entered the value, it seems to have logged,
> but a few secs later, it's gone, and reset to empty.

## It is not the bug it looked like

Spec 041 fixed a keyboard that would not open. This is a different failure with
a similar shape from the outside: the value **does** get entered, and **does**
get written. Then a later write puts the old one back.

`updateCatch` carried this comment:

> A field is only written when the caller mentioned it, so a form that submits
> three fields cannot blank the other seven.

That is the right rule. The code did the opposite. It read the whole specimen
and encounter **before** opening its transaction, then wrote **every** field
back, filling anything the caller had not passed from that earlier read.

A read-modify-write. Two of them overlapping lose one another's changes, and
which one survives depends on timing.

## Why it started biting now

The pattern was survivable for as long as one form gathered every field and
submitted them together — there was only ever one writer.

Spec 039 removed that form and made each field save on its own; spec 041 made
every field a live input. **A finger moving from one field to the next now
fires two commits milliseconds apart.** The second reads state from before the
first landed and writes the stale value over it.

So the regression was introduced by the change that made editing feel right,
which is worth recording: the new interaction did not create the defect, it
made a latent one reachable several times a minute.

## Reproduced, in both directions

The bug has two faces and a test guards each:

| | |
|---|---|
| two fields saved at once | one of them **silently lost** |
| a field cleared, another saved | the cleared value **came back** |

The second is the reported one seen from the other side — a value returning
where it should not is the same stale write as a value vanishing.

## The fix

Dexie's `update()` already merges: a key that is absent from the patch is left
alone. So there was never a reason to read the record first.

The patch now carries **only the keys the caller passed**. `undefined` deletes,
which is what `null` means at this boundary, and two concurrent edits of
different fields cannot reach each other's values. The record is no longer read
before writing at all, so there is no stale snapshot to write back.

This also removes a smaller wrong thing: `exceptional` was written on every
call, so a record with no such flag had the property deleted and re-deleted on
every edit — a mutation sent to the server each time for a field nobody had
touched.

## Not done

- **Auditing the other read-modify-writes.** `updateCatch` is the one reached
  by per-field editing, so it is the one that bites today. `setTankPhoto`,
  `recordDeath` and the tank form have the same shape and are still
  single-writer; they should be checked before they are made live-editing too.
  Filed rather than fixed here, because each needs its own thought about what
  concurrent means for it.

## Acceptance criteria

1. Two fields saved at once both survive. ✅
2. A cleared field stays cleared when another is saved beside it. ✅
3. No field the caller did not mention is written. ✅
4. Both guards fail if the read-modify-write is put back. ✅ (checked)
5. `vitest run` and `npm run build` green. ✅
