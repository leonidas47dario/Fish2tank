# 027 — A read path must not write, or the screen goes blank

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-A09 (the gate), FR-R10 (the catalog), NFR-01 (the app renders).
**Fixes:** a regression introduced by spec 022.

---

## What was asked

> the click on tile in still doesn't seems to be working it just opens a blank
> new page, also the sign out button was broken need fix.

Two reports. **One cause.**

## The cause

`loadProfile()` creates `user_local` when it is missing — a **write**:

```ts
const existing = await database.users.get(LOCAL_PROFILE_ID);
if (existing) return existing;
const created = blankProfile(legacyRaw);
await database.users.put(created);   // <- here
```

Four read paths called it from inside a `useLiveQuery` callback:
`tank-residents.ts`, `hooks.ts`, `SpeciesDetail.tsx`, `Catalog.tsx`. Dexie runs
those in a **read-only transaction**, so the write is rejected with
`ReadOnlyError`, the query throws, and React renders nothing.

Reproduced against the built uat bundle before any change:

```
SPECIES page text length: 0
errors: ReadOnlyError
```

A blank page, exactly as reported.

### Why now, when none of this code is new

It was latent for as long as it existed, and something else was hiding it.

`Settings.tsx` had already found this trap and avoided it, in a comment that
ended:

> ThemeProvider has already created the row by the time this screen renders.

That was true, and **spec 022 made it false.** ThemeProvider mounts above the
gate and `users` is a synced table with a hardcoded key, so every signed-out
launch was queueing a default profile to be pushed over the account's real one
— which is one of the ways tank edits were being lost. Removing that eager
write was correct and is not being undone here. It also removed the thing that
happened to be creating the row before any read path needed it.

### Why both reports are this

**The tile click.** Spec 025 gave a shared tank's tile somewhere to go —
`/species/:id`. That destination was the blank page. The tile is working; the
page it opens was broken, which is why it looked like a navigation bug.

**Sign out.** `db.cloud.logout()` clears every table, `users` included. So the
row disappears and the very next screen that calls `loadProfile()` inside a
live query throws. Pressing Sign out emptied the app instead of returning to
the gate, so the button looked broken. It was doing its job; what came after
could not draw.

## The change

`readProfile()` already exists — spec 022 added it, reads and never writes,
returning `blankProfile()` when the row is absent. The four read paths now use
it. `recordPrice()` keeps `loadProfile()`: it is a genuine write path, where
creating the row is correct.

`Settings.tsx`'s comment is corrected rather than deleted. Its reasoning was
right and its final assumption is what expired; a future reader needs to know
that nothing may rely on the row existing before it is deliberately written.

## Alternatives rejected

- **Make `loadProfile()` never write.** It has one legitimate caller that needs
  the row created. Silently changing it would move the bug rather than fix it,
  and leave a function whose name promises more than it does.
- **Have ThemeProvider create the row again.** It is precisely what spec 022
  removed, and restoring it would re-open the overwrite that was losing tank
  edits — trading a blank screen for silent data loss.
- **Catch `ReadOnlyError` at the call sites.** Treats the symptom, and a caught
  write is still a write that did not happen; the profile would go on not
  existing while every read pretended otherwise.

## How this was verified

The guard fails on the old behaviour: putting `loadProfile()` back into
`loadTankResidents` turns the new test red.

Then in a real browser, past the gate in developer mode, with `users` **empty**
— the exact state sign-out leaves behind:

| screen | before | after |
|---|---|---|
| species | **0 chars, ReadOnlyError** | 1,186 chars, renders |
| catalog | (same fault) | 93,917 chars |
| home / tanks / settings / journal | — | all render |

`users` rows created by browsing every screen: **0**, which is the property
that was wrong and is the one worth keeping.

## Acceptance criteria

1. No read path calls a function that writes. ✅
2. Every screen renders with `users` empty. ✅ (browser)
3. Browsing creates no profile row. ✅ (browser, counted in IndexedDB)
4. The write path that legitimately creates the row still does. ✅
5. A test fails if a read path goes back to `loadProfile()`. ✅ (proven by
   reintroducing it)
6. `vitest run` and `npm run build` both green. ✅
