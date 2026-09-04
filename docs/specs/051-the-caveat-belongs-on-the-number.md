# 051 — Remove "What this leaves out", keep what it was protecting

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-E05, P6 (never invent a number), FR-L03.
**Amends:** spec 023, which put this section on the viewer.

---

## What was asked

> What this leaves out section can be removed

## What the section was doing there

It is worth saying, because it was not decoration. `tank-stats.ts` opens with
the rule the whole dashboard is built on:

> every total here reports its own denominator: how many fish it counted, and
> how many it could not. A dashboard that silently averaged over 80% of a tank
> and presented it as the tank would be the most confident kind of lie.

*What this leaves out* was where that denominator got said. It carried two
notes:

1. *"5 of 24 fish are recorded by name only and could not be matched to a
   species, so they are outside every chart above."*
2. *"The estimate covers 19 of 24 fish; the rest have no market listing to
   price them from."*

## Why removing it is fine, and where it is not

**The first note is redundant now**, in a way it was not when spec 023 wrote
it. Every chart on the dashboard already renders its own *Not recorded* / *Not
rated* bar with a count, and since spec 049 that bar is tappable — so a keeper
can not only see the part the chart cannot speak for but select it and get the
exact fish. A sentence restating it five sections lower is a footnote to
something already on screen.

**The second note is not redundant, and it qualifies a money figure.** Nothing
else on the page says the estimate covers only some of the tank. Dropping the
section without dealing with it would leave `$1,375 est. value` presented as
the tank's value while covering nineteen of twenty-four fish — a plausible
number standing in as fact, which is exactly what P6 forbids.

So the section goes, and **the caveat moves onto the number it qualifies**: the
stat tile reads `est. value` with `covers 19 of 24` beneath it, and shows
nothing extra when the estimate covers everything. That is a better place for
it than a footnote was — a reader who never scrolls to the bottom of the page
was never protected by the old version anyway.

## Not done here

- **Keeping the unidentified-fish note somewhere else.** The charts say it, and
  more usefully. If it turns out to be missed it is four lines to restore.
- **Changing what the estimate counts.** Untouched.

## Acceptance criteria

Verified in a real browser against the built bundle at 390px, on three tanks
seeded for the three coverage states.

1. The *What this leaves out* section no longer appears on a tank. ✅ — zero
   occurrences of the heading, and none of its prose either.
2. Nor on a shared tank, which renders the same viewer. ✅ — the component is
   deleted, not conditionally hidden, so there is no path that renders it.
3. An estimate that covers only some of the tank says so, on the tile. ✅ —
   `$225 · est. value · covers 1 of 2`.
4. An estimate that covers every fish says nothing extra. ✅ — `$450 · est.
   value`, no note.
5. A tank with no market data at all still reads "no market data". ✅ — `— · no
   market data`, no note.
