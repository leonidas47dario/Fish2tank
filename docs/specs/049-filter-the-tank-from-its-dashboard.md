# 049 — Filter the tank by tapping its dashboard

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-E04 (every factor reachable), NFR-06 (colour is never the only
cue), P6.
**Builds on:** spec 023, which made the dashboard and the grid one shared
viewer.

---

## What was asked

> Another feature, I'd like to be able to click on the dashboard and filter the
> tank. E.g temperament or where they swim

## The problem behind it

The dashboard answers *how many* and the grid answers *which ones*, and until
now **nothing connected the two**. A keeper reading "Aggressive 2" on a tank of
24 fish learned that two of them are a problem and had no way to find out
which: the only route was to open each of fifteen species pages in turn and
remember what each said. The number that raises the question is the one thing
on the screen that cannot answer it.

"E.g." is doing work in the request, so this covers every chart that sorts fish
into groups rather than only the two named — where they swim, temperament, and
a species from *Grown up*. Leaving one chart inert would teach the reader that
tapping charts sometimes does nothing, which is worse than none of them being
tappable.

## What a tap does

One selection per chart, **combinable across charts**. Tapping *Bottom* and
then *Aggressive* answers "which of my aggressive fish are bottom-dwellers",
which is the question a keeper actually has and which no single chart can
answer. Tapping a selected bar again clears it.

A summary line above the grid says what is being shown and offers one control
to clear everything, so there is never a filtered grid without a visible reason
for it.

### The charts keep their whole-tank numbers

Tapping *Bottom* does **not** redraw Temperament for bottom-dwellers only.

That was the tempting version and it is worse on a phone. The charts are the
navigation; if they re-counted on every tap, the bar you meant to press next
would move or vanish under your finger, and clearing back out would mean
hunting for a control whose position had changed. Stable bars, a highlighted
selection, and a count on the grid — *"Showing 3 of 24"* — answer the same
cross-tab question without the ground moving.

### "Not recorded" and "Not rated" are selectable

They are the most useful filters on the screen, not a leftover bucket: tapping
*Not recorded* is how a keeper finds precisely the fish whose care data is
missing. Excluding them would also contradict the rule the whole dashboard is
built on — the tank is never fully described by the catalog, and every total
reports its own denominator (`tank-stats.ts`). A filter that could not reach
the unknown part would be pretending it is not there.

## The accessibility problem this had to solve first

Both charts were `<div role="img" aria-label="Top: 1 fish, Middle: 6 fish…">`.
That is correct for a static chart and **incompatible with an interactive
one**: `role="img"` collapses its whole subtree, so a screen reader is never
told the children exist, and buttons inside it are unreachable. Making the
bars tappable without changing that would have shipped a feature keyboard and
screen-reader users cannot use at all.

So an interactive chart drops `role="img"` and each bar becomes a real
`<button>` carrying its own label — *"Bottom, 14 fish"* — and `aria-pressed`
for its state. The components still render a static chart when no `onSelect`
is passed, keeping the `role="img"` summary, so using one directly is not a
regression.

**A guest on a shared page gets the filter too**, because `TankViewer` is one
component and both callers pass through it. That is the right outcome rather
than an oversight: filtering writes nothing and reaches no database, it is the
same view state either way, and a stranger trying to make sense of somebody
else's twenty-four fish has more use for "show me the aggressive ones" than the
owner does. The real buttons are also a better screen-reader experience than
the `role="img"` summary they replace.

The temperament bar is the one exception to bars-as-buttons: a 6px sliver is
not a tap target anybody can hit, so it stays decorative and the legend row
beneath it carries the selection at a size a thumb can land on.

Selection is never signalled by colour alone (NFR-06): a selected bar carries a
ring and its label goes bold, and `aria-pressed` carries it for anyone not
looking at the screen.

## Where P6 bites

The filter never invents a match. A fish with no `waterZone` matches the
*Not recorded* selection and no other — it is not quietly counted into
whichever bucket seems likely, and it does not silently disappear from a tank
being filtered by a dimension nobody recorded for it. That is the same rule the
tallies already follow, applied to selection.

**The count above the grid is of fish, not of holdings**, matching every other
number on the dashboard. A holding of six tetras is six fish, and a grid that
said "showing 1 of 24" while displaying six animals would disagree with the
stat tile directly above it.

## Not done here

- **Cross-filtered charts.** See above.
- **Filtering by size range.** *Grown up* filters to one species, which is what
  its rows are. A range needs a control the chart does not have.
- **Remembering a filter across visits.** A filter is a question you are asking
  right now, not a setting. It clears on leaving, which is also why nothing is
  persisted.
- **Filtering "Who lived here before".** That section is about the tank's past
  and the charts describe its present; a filter spanning both would be claiming
  a departed fish is in a bucket the dashboard counted without it.

## Acceptance criteria

1. Tapping a zone bar filters the grid to those fish. ⬜
2. Tapping a temperament segment or its legend row does the same. ⬜
3. Tapping a *Grown up* row filters to that species. ⬜
4. Two filters from different charts combine. ⬜
5. Tapping a selected bar again clears it, and one control clears everything. ⬜
6. The charts keep their whole-tank numbers while a filter is on. ⬜
7. *Not recorded* / *Not rated* select the fish with no data. ⬜
8. The count above the grid counts fish, not holdings. ⬜
9. Every bar is a real button with its own label and pressed state, and no
   interactive chart is inside `role="img"`. ⬜
10. A combination that matches nothing says so and offers the way out. ⬜

## Verified

Driven in a real browser against the built bundle at 390px, on a seeded tank of
12 fish across 7 holdings and 5 species — deliberately including a group of six
and one fish the catalog could not resolve at all.

1. Tapping a zone bar filters the grid to those fish. ✅ — *Bottom* gave
   "Showing 8 of 12", 3 tiles.
2. Tapping a temperament legend row does the same. ✅
3. Tapping a *Grown up* row filters to that species. ✅ — and both holdings of
   that species highlight, which is what explains 7 fish across 2 tiles.
4. Two filters from different charts combine. ✅ — *Bottom · Peaceful*,
   "Showing 7 of 12", two bars reading `aria-pressed="true"`.
5. Tapping a selected bar again clears it, and one control clears everything.
   ✅ — un-tapping *Bottom* left "Showing 9 of 12 — Peaceful"; **Clear** removed
   the summary entirely and restored all 7 tiles.
6. The charts keep their whole-tank numbers while a filter is on. ✅ — the
   rendered chart text was captured before and after and compared; identical.
7. *Not recorded* / *Not rated* select the fish with no data. ✅ — "Showing 1
   of 12", and the one tile was the unresolved *Mystery Pleco*.
8. The count above the grid counts fish, not holdings. ✅ — "Showing 7 of 12"
   over 2 tiles, one of which is a group of six.
9. Every bar is a real button with its own label and pressed state, and no
   interactive chart is inside `role="img"`. ✅ — labels read "Top, 1 fish",
   "Bottom, 8 fish"; zero `.watercolumn[role="img"]` on the page.
10. A combination that matches nothing says so and offers the way out. ✅ —
    *Top · Aggressive* (the one aggressive fish is a bottom-dweller) gave
    "Showing 0 of 12" and "No fish match that."

Also checked: the **Add a fish** tile is hidden while a filter is on, since it
would add a fish the filter may immediately hide again.
