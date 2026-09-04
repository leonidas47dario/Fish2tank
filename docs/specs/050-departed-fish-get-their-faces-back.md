# 050 — A departed fish is still a fish, so show its face

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-J01 (the media is the record), FR-L03 (tone), P3, P6.
**Builds on:** spec 048, which built the section; spec 021, which settled which
picture a fish wears.

---

## What was asked

> Who lived here before should also show up as photos, same format as who lives
> here

## Why the list was wrong, stated plainly

Spec 048 shipped this section as a text list — a mark, a name, two dates, some
links — beneath a grid of photographed tiles. That put **the fish you lost in a
plainer format than the fish you still have**, on the one screen where that
distinction reads as a judgement. A tank whose living residents get faces and
whose dead get a bulleted line is saying something nobody meant.

It is also inconsistent for no reason. `chooseArt` (spec 021) has decided which
picture a fish wears since long before this section existed, and the section
simply never asked it. The photographs were already there.

## What changes

The section renders the **same `.tank-grid` of `.tank-tile`s** as *Who lives
here*, through the very same `ResidentTileContent` component — not a copy of
it, so the two cannot drift into looking almost alike, which is worse than
either looking different or looking identical.

Each tile carries, under the name, the one line the list carried: the span of
time, and what happened at the end of it.

## Three things a departed tile must do that a resident tile must not

1. **Read as gone.** Identical tiles for the living and the departed, in two
   grids under two nearly identical headings, is a way to misread your own
   tank. The departed tile is dimmed — the treatment `.tank-tile--plain`
   already exists for exactly this and is reused rather than invented.
2. **Carry the wing mark where a death happened here.** It is what separates
   *remembered* from *moved on* at a glance, and losing it to make the formats
   match would trade a fact for a symmetry.
3. **Lead somewhere.** One tap target per tile, like the grid above — the
   list's three competing links inside one row were already too many for a
   thumb, and a tile has less room, not more. In order of what the reader is
   most likely asking: the memorial, else the fish's own record, else the tank
   it moved to. That last rung is not a nicety: a holding created by
   `stockTank` or the inventory import has **no specimen and therefore no
   record page**, which left two of three tiles inert in the first build of
   this. A fish with none of the three stays a plain tile rather than a dead
   link, which is the rule the resident grid already follows.

## Where the picture comes from, and where it must not go

The art is resolved in the **hook**, not in `loadTankResidents`.

That is a deliberate boundary rather than a convenience.
`loadTankResidents` feeds the public shared-tank projection as well as the
owner's screen, and spec 023's whole point is that the projection publishes
bundled portraits and never the keeper's private photographs. Teaching that
function about departed fish would put their pictures one careless field away
from a public page — and spec 048 already decided the departed do not appear on
a shared tank at all. The hook is inside the account by construction, so the
question cannot arise there.

Precedence is `chooseArt`'s, unchanged: the keeper's own photograph of *this*
fish where there is one, the bundled portrait otherwise, and the honest empty
placeholder when neither exists. Blobs go through `useBlobUrls`, so the URLs
are revoked like every other media reader in the app (BUG-13's rule).

## Where P6 bites

A fish with no photograph and no resolvable species gets the same empty
placeholder the resident grid uses. It does not borrow a portrait of something
that looks similar, and it is not hidden from the section for want of a
picture — the fish lived there, which is the only thing the section claims.

## Not done here

- **Photographs on a shared tank's departed list.** There is no departed list
  on a shared tank (spec 048), and NFR-04's unsolved EXIF problem would apply
  to any photograph that appeared there.
- **A photograph on the memorial *card* in `/heaven`.** It already has one.

## One more thing this found

**A fish stocked straight into a tank rendered as "A fish".** `stockTank`
deliberately creates no specimen (FR-T02) and sets no `rawLabel`, so spec 048's
name chain — nickname, label, specimen label — fell all the way through to the
placeholder. Survivable in a text list; not on a tile with the fish's own
portrait beside the name. The catalog's common name is now a rung in that
chain, handed into the pure function as a map rather than imported, so
`domain/` still imports no catalog. What the keeper typed still wins over it.

## Acceptance criteria

Verified in a real browser against the built bundle at 390px, on a tank seeded
with one departed fish of each art case plus a live resident, so both grids
render side by side.

1. *Who lived here before* renders as a tile grid in the same format as *Who
   lives here*. ✅ — same `.tank-grid`, same `.tank-tile`, same
   `ResidentTileContent`.
2. A fish photographed by the keeper shows that photograph. ✅ — a `blob:` URL.
3. A fish with no photograph but a known species shows the bundled portrait. ✅
   — `/assets/sp_pao_abei-…jpg`, an asset path rather than a blob.
4. A fish with neither shows the empty placeholder and is still listed. ✅
5. A tile reads as departed rather than resident. ✅ — `.tank-tile--plain`,
   computed opacity 0.7.
6. A death that happened here still carries the wing mark. ✅ — one wing mark
   on the page, on the one fish that died here.
7. Each tile is one tap target, leading to the memorial, else the record, else
   the tank it moved to. ✅ — three tiles, exactly one link each.
8. No object URL leaks: the section's URLs are revoked with the component. ✅ —
   **measured**, not assumed: `createObjectURL` and `revokeObjectURL` were both
   counted across five round trips in and out of the tank. 5 minted, 5 revoked,
   0 outstanding. This is the leak BUG-13 filed, checked rather than trusted.
