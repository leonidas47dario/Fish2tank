# 021 — Your photo in your tank, and a tank for the fish you cannot name

**Status:** implemented.
**Date:** 2026-08-31.
**Touches:** P3 (the exact specimen matters), FR-T02 (a holding needs no specimen and no species), FR-I01 (Unknown is a valid state).
**Amends:** spec 005's identity gate, narrowly.

---

## What was asked

> Some bugs I noticed. 1. fish (catch) that doesn't have a profile can't be
> added toward a tank. 2. when a fish is added to the tank, its profile pic is
> displayed rather than the photo I took.

Both reproduced against `uat` at `f8ba211` before anything was changed:

```
BUG1 — "If it comes home" present: 0
BUG2 — tank tile art: [{"tag":"IMG","src":"/assets/sp_green_severum-DXAUJscz.jpg"}]
```

The second is a stock asset path while the specimen had a photo of its own
attached.

## Bug 2 — the tank grid never looked at your photos

`useTankResidents` built every tile's picture as

```ts
portraitUrl: holding.speciesId ? portraitAsset(holding.speciesId) : undefined,
```

The reference portrait, unconditionally. Not a precedence bug, an absence: the
grid had no code path that could ever reach a photo of yours, and it ignored
the card-art preference too. A tank of fish you had photographed drew a grid of
stock images, which is principle P3 exactly inverted.

### The fix reuses the rule rather than writing a second one

`resolveCardArt` already encodes the precedence — your photo unless you asked
for the portrait, the bundled portrait otherwise, your photo again when no
portrait exists, a silhouette last. It was reachable only through a
`CatalogCard`, whose photo pool is **every photo of the species**.

A tile needs the same rule over a narrower pool: the photos of *that fish*. Two
green severums in two tanks are two faces, and one having a photo must not lend
it to the other.

So `chooseArt(species, ownMediaIds, pref)` is extracted and `resolveCardArt`
becomes a one-line wrapper. One precedence, two callers, no chance of drift.
`species` is optional, because a tank can hold a fish nobody has identified —
the importer produces exactly that — and such a fish has no portrait to fall
back to.

### Blobs, and the leak that was easy to write

Your photos are bytes in IndexedDB, not URLs. `blob-url.ts` exists because four
hand-rolled versions of this had been written and two leaked, so the hook now
does what `useSpecimenMedia` does: the Dexie query picks the art and yields the
blob, and `useBlobUrls` owns the object URL.

The query result is handed to `useBlobUrls` **unmapped**. `useLiveQuery` keeps
one object identity between renders, so `raw.ownBlobs` is stable; a `.map()`
there would mint a fresh array every render and re-create every URL each frame.

`TankResident.portraitUrl` is renamed `artUrl`, because it is no longer
necessarily a portrait and a field that lies about its contents is how this
started.

## Bug 1 — the identity seal caught something it was not aimed at

Spec 005 made identification hard-blocking: *"all records must be identified."*
It is enforced with a single early return rather than nine per-panel guards,
and the file says why — *"a per-section guard is one forgotten `&&` away from
leaking; this cannot leak."* That is sound, and placement was swept up in it.

**This reverses part of a decision made deliberately, so the reasoning is set
out rather than assumed.** The seal's own justification is printed on screen:

> Price, tank screening, Discovery and the story all describe a species, so
> they have nothing to say until this one has a name.

That reason is true of all four and false of the fifth. A tank placement does
not describe a species, it records where an animal physically is, and you can
know that perfectly well while still arguing about what the fish is called. The
data layer never disagreed: `acquireSpecimen` copies `specimen.speciesId`
straight through, undefined and all, and the inventory importer has always
created tank residents with no species whatsoever.

So placement moves outside the gate and nothing else does. Price, screening,
Discovery, story and the market panel stay sealed, and the seal keeps its
structural form — the panel is lifted into a variable and rendered on both
branches, not copied.

The note on the sealed record is reworded to match. It used to say "The rest of
this record opens once it has a label", which is no longer true of the panel
now sitting above it.

## Out of scope

- **The tile's caption.** It still shows the catalog common name rather than a
  nickname, so a tile can read "Green Severum" for a fish you call pineapple.
  Not reported, and it is a different question from which picture is drawn.
- **Making `unknown` unreachable.** Spec 005 already recorded that the back
  button and every pre-existing record produce them and a single-page app
  cannot prevent it.

## How this was tested

`chooseArt` gained six cases: own photo beats portrait, a fish with no photo of
its own does not borrow a sibling's, an explicit portrait preference still
wins, newest first, and both outcomes for an unidentified fish. Every existing
`resolveCardArt` test passes unchanged through the new wrapper, which is the
point of making it a wrapper.

The wiring is hook and JSX, so it was measured in the browser with one script
run twice, before and after, against the production build:

| | before | after |
|---|---|---|
| "If it comes home" on an unidentified record | absent | present, with a tank picker |
| tank tile art | `/assets/sp_green_severum-…jpg` | `blob:…` (the uploaded photo) |

The tile was also read as pixels rather than as a `src` attribute, to confirm
the object URL survives to paint rather than being revoked under the `<img>`.

1,036 tests across 58 files, up from 1,030. `npm run build` green.

## Acceptance criteria

1. A tank tile shows your photo of that fish when it has one. ✅
2. A fish with no photo of its own still shows the reference portrait, and does
   not borrow a tankmate's picture. ✅
3. An explicit "use the reference portrait" choice is still honoured. ✅
4. An unidentified catch can be put in a tank. ✅
5. Price, screening, Discovery and the story remain sealed until it is named. ✅
6. `vitest run` and `npm run build` both green. ✅
