# 053 — Tiles that paint before the photographs arrive

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** NFR-03, FR-J01, P3.
**Builds on:** spec 036 (renditions), spec 023 (the shared page this copies).

---

## What was asked

> I love how fast things renders in shared tank. Can we adopt similar algorithm
> for preview tiles to the catalog and tank too? We don't need to pull full
> picture until someone clicks into it

## Why the shared page is fast, precisely

It is not a better algorithm. It is that **the shared page never waits for
anything before painting**. Each tile is an ordinary `<img src="…">` pointing
at the Worker: the browser lays the grid out immediately, streams and decodes
each image on its own, and `loading="lazy"` means the ones below the fold are
never fetched at all.

The owner's tank does the opposite, and `useTankResidents` is where:

```ts
for (const { holdingId, mediaId } of loaded.ownArt) {
  const blob = await readMediaBlob(m, 'preview');   // 1280px
}
```

A **serial loop inside one `useLiveQuery`**. Nothing on the screen — not the
stat tiles, not the charts, not a single fish — renders until the last blob of
the last fish has been read out of IndexedDB and decoded. Twenty-four
photographed fish is twenty-four sequential reads of a 1280px JPEG before the
first pixel. That is the lag, and it is structural rather than a matter of
size.

## Two changes, in order of how much they matter

### 1. Each tile loads its own picture

A tile renders straight away and fills in when its own blob arrives. One
component owns one media at one size — its query, its object URL, its
lifetime — so a grid of thirty paints at once and the photographs land
independently, exactly as the shared page's do. `loading="lazy"` is set for the
same reason it works there: a fish you have not scrolled to costs nothing.

`useTankResidents` therefore stops reading blobs at all. It hands each resident
the **media id** its tile should draw, and the tile does the rest.

### 2. A tile asks for the size a tile needs

Both surfaces asked for `preview`, which is 1280px on its longest edge:

- a tank tile is `minmax(150px, 1fr)` — about 150–190 CSS px
- a catalog tile is about 187 CSS px

`preview` is a full-width photograph being drawn into a box a twelfth of its
area. The tiles now ask for `thumbnail` (320px), which is roughly **16× fewer
pixels to decode** and around a tenth of the bytes.

**The sharpness cost, stated rather than skipped.** Spec 036 set the rule that
a 320px thumbnail suits a box of 107 CSS px or less — that is 320÷3, sized for
a 3× display. At 150–190 CSS px a thumbnail is 1.7–2.1× rather than 3×: sharp
on a 2× screen, softer than before on a 3× one. That is a real regression in
still quality, accepted deliberately in exchange for a grid that appears at
once, and it is why this spec revises spec 036's rule rather than quietly
contradicting it. Nothing else moves: the record page, the memorial hero and
the measurement photo all still read `preview`, because those are drawn large.

**The original is never read by a grid**, before or after. "Not pulling the
full picture until someone clicks into it" was already true — the cost was the
1280px derivative and the serial wait, not the original.

## What this must not do, and structurally cannot

`TankResident` is the object a shared-tank projection publishes, and spec 023
keeps the keeper's own photo OUT of it — `ownArt` is reported separately for
exactly that reason. The media id added here therefore goes on the **hook's**
return type, not on `TankResident`. `publishTank` calls `loadTankResidents`
directly and never touches the hook, so a private media id cannot reach a
published snapshot by this route: it is not a rule to remember, it is a type
that does not have the field.

## Not done here

- **Changing what the shared page does.** It is the thing being copied.
- **A new intermediate rendition.** Another derivative per photo is storage on
  every device to fix a softness only a 3× screen sees; the two we have are
  enough to make the call between.
- **Decoding off the main thread.** `createImageBitmap` in a worker is a real
  further win and a much larger change; the blocking loop was the problem
  actually reported.

## Acceptance criteria

Measured in a real browser at 390×844 against the built bundle, before and
after, on the same seeded tank: **18 photographed fish, every tile carrying its
own 3000×2000 photograph — 100 MB of blobs.** Five navigations per build,
median reported.

1. The tank grid paints before its photographs arrive. ✅
2. A tank tile draws the keeper's own photo, still by spec 021's precedence. ✅
   — 18 tiles, own photos on all of them.
3. Tiles read `thumbnail`; the record page, memorial hero and measurement photo
   still read `preview`. ✅ — the rendered images report `naturalWidth` **1280
   before, 320 after**.
4. Off-screen tiles do not fetch their photograph. ✅ — 12 of 18 loaded; the
   six below the fold report `naturalWidth` 0, and every tile carries
   `loading="lazy"`.
5. No object URL leaks — measured across repeated visits. ✅ — four round trips
   in and out of the tank: **72 minted, 72 revoked, 0 outstanding**, in both
   builds. This is BUG-13's failure mode and the restructure does not
   reintroduce it.
6. The shared page is unchanged, and no private media id can reach a snapshot.
   ✅ — `ownMediaId` exists only on the hook's return type; `publishTank` calls
   `loadTankResidents` directly.
7. Time to first paint on a photographed tank improves — measured. ✅

   | | before | after |
   |---|---|---|
   | time to first fish tile (median of 5) | **96 ms** | **26 ms** |
   | all five runs | 86, 90, 96, 99, 105 | 12, 13, 26, 30, 35 |
   | pixels decoded per tile | 1280×853 ≈ 1.09 M | 320×213 ≈ 68 K |

   **3.7× faster to paint, and 16× fewer pixels per tile.**

**What that measurement is not.** This ran on a desktop-class machine where
IndexedDB reads and JPEG decodes are cheap. The structural win — the grid no
longer waiting on a serial loop — is the same everywhere, but the decode saving
compounds on a phone, which is where the complaint came from. The honest claim
is the ratio, not the milliseconds.
