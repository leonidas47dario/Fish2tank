# 044 — An edit with nowhere to go

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** FR-C03 (correct the record), FR-T02, P6.
**Fixes:** BUG-17. The second half of the report that produced spec 043.

---

## What was reported

> The bug persists when I edit a profile from "recent catch", but seems to be
> working if I go to profile -> find fish and update there.

That sentence is what found it. Spec 043 fixed a real race and did not fix
this, and without the observation that one route worked I would have gone on
looking at timing.

## Both routes end at the same screen, so it was never the route

`/specimen/:id`, the same component, the same code. What differs is **the fish
each route tends to reach**.

- `createCatchDraft` creates a specimen **and an encounter**, together.
- `ensureSpecimenForHolding` creates **only a specimen** — it exists to give a
  record to a holding that arrived from the inventory import.

So a fish minted for one of the 61 imported rows has **no encounter at all**.
And `updateCatch` amended the latest encounter, of which there was none:

```ts
if (target && Object.keys(chapter).length > 0) { ... }
```

No target, no write, **no error**. Every encounter-shaped field — seen on,
shop, how many you saw, size — went nowhere. The specimen-shaped ones,
nickname and the store's label, saved perfectly, which is why the screen looked
half-working rather than broken.

The field then showed the typed value until the next render and reverted to
empty, because the value it syncs from had never changed. *"It seems to have
logged, but a few secs later it's gone."*

### The Home shelf is not a list of catches

`useRecentCatches` reads `db.specimens.toArray()` and sorts by `createdAt` —
**every** specimen, not only the ones with an encounter. So the shelf happily
offers imported fish, which is exactly how "recent catch" became the route that
failed.

## The fix: record it, rather than drop it

When there is no encounter to amend, one is created.

That is not a workaround for a missing row. *"How big it was, where, and
when"* **is** an encounter — that is what the table is for — so the honest
response to being handed one for a fish that has none is to write it down.

Two details worth stating:

- **The encounter is chosen inside the transaction now.** Reading it outside
  was the remaining half of spec 043's stale read, and it matters more here:
  two edits racing on a fish with no encounter would each decide to create one,
  and the fish would end up with two.
- **A specimen-only edit creates nothing.** A nickname is not an observation of
  a fish in a place on a day, and minting an encounter to hold one would put a
  chapter in the Story that nobody wrote.

## What a keeper will notice

An imported fish that gains its first encounter also gains **"Chapter 1"** in
its Story, with no note. That is truthful — it is a dated observation, which is
what a chapter is — but it appears without being asked for, so it is recorded
here rather than left to be discovered.

## Not done

- **Renaming `useRecentCatches`.** It returns every specimen, not every catch,
  and the name misled me while reading it. A rename touches Home and its tests
  and is not this fix.

## Acceptance criteria

1. An encounter-shaped edit on a fish with no encounter is stored. ✅
2. It uses the date the keeper gave, not the moment they typed it. ✅
3. Repeated edits fill one encounter rather than making several. ✅
4. A specimen-only edit invents no encounter. ✅
5. Every field on both kinds of fish survives a reload. ✅ (browser)
6. All three guards fail if the silent drop is restored. ✅ (checked)
7. `vitest run` and `npm run build` green. ✅
