# 035 — A shared tank says what it does, and answers where you can see it

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-S02 (a shared tank renders without an account), FR-S06 (the tap survives the sign-in), NFR-06 (state survives greyscale).
**Fixes:** two reported defects in spec 025, and one nobody reported.

---

## What was asked

> 1. Right now there is no hint to click on a fish to see details
> 2. When I clicked on a fish, if I couldn't see the info because I didn't sign
>    in, it should give me a pop up or notification or at least force scroll me
>    down to see the msg. Otherwise right now if the list is long, I couldn't
>    see the msg at all.

Both are defects in spec 025, which built the tap and the peek and then put the
answer somewhere nobody would look.

## 1. A tile that is a button but does not look like one

Spec 025 made the whole tile an activatable control and gave it nothing to say
so. On a phone there is no hover to reveal it, so the affordance has to be
permanently visible or it does not exist.

Two cues, deliberately not three:

- **One line above the grid**, in words: *"Tap a fish to read about it, or the
  heart to add it to your Dream List."* A wall of fish with a chevron on every
  tile is noisier than one sentence.
- **The fish's name carries it**, underlined and in the primary colour — the
  one convention every reader already has. Plus a press state on the art, so a
  tap feels like it landed.

## 2. An answer rendered below the fold is not an answer

The peek and the join prompt were siblings **below** the grid. On a tank with
four fish that reads fine. On a tank with twenty-four, the keeper taps a fish
near the top and, as far as they can tell, nothing happens.

Scrolling the panel into view would fix the symptom and not the shape. This is
a question the page is asking, and the page should stop until it is answered.
So both are now a **sheet**: fixed to the bottom of the viewport, over a scrim,
which on a phone is the native idiom for exactly this.

It is a dialog in the accessibility sense too, not a `div` that looks like one:

- `role="dialog"`, `aria-modal`, and a label naming the fish
- focus moves to the panel on open and returns to the tile on close — the half
  everybody forgets, without which a keyboard lands back at the top of the page
- **Escape** dismisses; the scrim is a real `<button>` rather than a click
  handler on a decorative layer, so it is reachable without a pointer
- the page behind stops scrolling while it is open, because on a phone that
  feels like the answer is running away from the finger

The panel is focused rather than its first control: a sheet that opens with
*Continue with Google* focused reads as though it has already decided.

## 3. The defect nobody reported, found while testing this

Driving a **24-fish** tank in a phone viewport to check the sheet, the panel
opened on the wrong fish: tapping the 21st tile showed the 6th.

`asResident` minted each tile's identity as `shared_${speciesId ?? index}`, and
both lookups then searched by species:

```ts
snapshot.residents.find((s) => s.speciesId === speciesId)
```

**A tank usually holds several fish of one species.** A school of six tetras
collided onto one id, so:

- the peek opened on whichever matched first, not the one tapped
- the heart targeted the same wrong resident
- `ResidentGrid` keys on `r.holding.id`, so React saw **duplicate keys** across
  the grid

One cause, three symptoms, and none of it visible on the two-fish fixtures the
earlier specs were tested against. The synthetic id is now the **index**, which
is unique by construction, and both lookups go through a map built from the
same index rather than guessing from a species.

The owner's own tank was never affected: there `holding.id` is a real holding
id. Only the published projection synthesises one, because the shared file
deliberately carries no ids of its own.

## How this was verified

In a real browser at a **390 × 844** phone viewport, on a 24-fish tank — the
reported condition, because the bug only exists when the list is long:

| | |
|---|---|
| hint line present | yes |
| tile name renders underlined | yes |
| panel within the viewport after tapping tile 21 | **yes**, top at 342 of 844 |
| panel is the fish that was tapped | **yes** (both the peek and the heart) |
| `role="dialog"` / `aria-modal` | yes / yes |
| page behind locked while open | yes, and restored on close |
| Escape dismisses | yes |

The identity fix was checked by putting the collision back; that run did not
get far enough to print its assertions, which is consistent with the duplicate
keys but is not a clean demonstration of a specific failure, and is recorded
here as what it was.

## Acceptance criteria

1. A shared tank says its tiles are tappable, without a badge per tile. ✅
2. The peek and the join prompt are visible however long the list is. ✅
3. Both are dialogs: labelled, focus-managed, Escape-dismissible. ✅
4. The page behind does not scroll while one is open. ✅
5. Tapping a fish opens **that** fish, in a tank with several of one species. ✅
6. No duplicate React keys in a shared tank's grid. ✅
7. `vitest run` and `npm run build` both green. ✅
