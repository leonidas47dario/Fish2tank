# 052 — A dashboard you can see past

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-E04, NFR-06, P6.
**Amends:** spec 023 (the charts), spec 049 (the filter).

---

## What was asked

> We can remove the grown up section, it's not adding real value. Also right
> now the chart is occupying too much space that its not obvious that clicking
> on it filters the rest of the tank

Two symptoms of one thing: **the charts are so tall that you cannot see a
chart and the grid it filters at the same time.** A filter you cannot watch
work does not read as a filter.

## Grown up goes

Spec 023 called it "the single most useful thing a keeper can show a guest,
because the two-inch fish in front of them is a fourteen-inch fish later". That
argument was about a **guest** being shown a tank. For the owner it is eight
rows restating the adult sizes of fish they chose, and it cost more vertical
space than the two charts that answer a real question. The keeper's verdict is
the one that counts here.

Its filter dimension goes with it. `speciesId` was reachable only from those
rows, so leaving it in `tank-filter.ts` would be a capability with no way in —
dead code that reads as a feature. The pure function, its type and its tests
lose that dimension rather than keeping it "just in case".

## The two that stay get shorter

Nothing is removed from them: every band, every segment, every count and the
`Not recorded` bucket all remain, because they are what the filter selects and
because P6 requires each total to keep reporting its own denominator.

What changes is the frame around them. The two charts were two full cards with
`h2` headings and card padding; they are now one card with two compact groups
under small headings. On a 390px screen that is the difference between the
charts and the first row of fish being on the same screen or not — which is
the whole complaint.

## Saying that a tap filters

Hover told you. **Touch has no hover**, so on the device this app is built for
the only affordance was the shape of the row, and a row is not obviously a
button.

So the card says it, once, in words: *"Tap anything below to filter the fish."*
One line, not a badge on every bar, and it is not a tooltip — a hint that only
appears on a gesture you do not know to make is not a hint.

The chevron-free treatment stays deliberate: adding a `›` to twelve rows would
spend a lot of ink saying "tappable" about things that are already, since spec
049, real buttons with `aria-pressed`. The words carry it for sighted users and
the roles carry it for everyone else.

## Not done here

- **Removing a chart's "Not recorded" row to save height.** That is the row
  that says what the chart cannot speak for, and since spec 049 it is also the
  most useful filter on the screen.
- **Collapsing the charts behind a disclosure.** A chart you have to open is a
  chart nobody opens, and the complaint was about seeing the filter work, not
  about seeing less.

## Acceptance criteria

Verified in a real browser at 390×844 against the built bundle, on the same
seeded tank before and after — eleven fish across six holdings, deliberately
including one the catalog cannot resolve so both *Not recorded* rows appear.

1. *Grown up* no longer appears on a tank, or on a shared tank. ✅ — the
   component is deleted, not hidden, and the shared page renders the same
   viewer.
2. The species filter dimension is gone from the domain and its tests. ✅
3. Both remaining charts keep every band, every count and the *Not recorded*
   bucket. ✅ — `Top 2 · Middle 4 · Bottom 4 · Not recorded 1` and
   `Peaceful 6 · Semi-aggressive 2 · Aggressive 2 · Not rated 1`, unchanged.
4. The dashboard is materially shorter — measured, not eyeballed. ✅

   | | before | after |
   |---|---|---|
   | first fish tile starts at | **1082px** | **781px** |
   | whole page | 1805px | 1504px |

   **301px higher — more than a third of a phone screen.** The charts now end
   at 719px, so the charts and the first row of fish are on screen together in
   an 844px viewport. Before, the first tile was below the fold, which is
   exactly why tapping a bar did not read as filtering anything.
5. The card says in words that tapping filters. ✅ — *"Tap anything below to
   filter the fish."*
6. Filtering still works from both charts, still combines, and still clears. ✅
   — `Bottom` → "Showing 4 of 11", plus `Peaceful` → "Showing 2 of 11 — Bottom
   · Peaceful", Clear → gone.
