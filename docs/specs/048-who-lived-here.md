# 048 — Who lived here

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-T03 (a fish moves between tanks), FR-L03 (tone), P6.
**Builds on:** spec 046, which built the memorial pages this links to.

---

## What was asked

> For fish heaven, perhaps add a who lived here section instead so we can also
> see passed fish in the same tank there were in?

"Instead" is answering the offer at the end of the last change — per-individual
measurement within a group — rather than replacing anything already built.

## The promise this makes good on

Fish Heaven's own subtitle, written in spec 046 and shipped, says:

> Still part of every tank they lived in.

That was true of the data and false of the app. A memorial recorded which
holding died, and a residency recorded which tank that holding lived in, and
**no screen ever joined the two**. Fish Heaven listed the dead in one flat
chronological column with no relation to place, and a tank showed only who is
in it right now. So a fish that lived in the 75 for two years vanished from
that tank the moment it died, and the sentence promising otherwise sat at the
top of a screen that could not deliver it.

The join needs no new storage. `Residency` has carried `aquariumId`,
`startDate` and `endDate` since the beginning; `Memorial` has carried
`holdingId` and `occurredOn` since FR-L02. What was missing was the question.

## Where the section goes, and why not in Fish Heaven

**On the tank.** "Here" is a place, and the only screen that is a place is the
tank. Putting a per-tank breakdown inside `/heaven` would be a list of tanks
inside a list of fish — the wrong nesting, and it would still not answer the
question a keeper actually asks, which is asked while looking at the tank.

Fish Heaven keeps its flat chronological index. The two now link both ways:
the memorial's "Lived in" row links to the tanks, and each tank links back to
the memorials.

## What "lived here" includes

Everyone who lived here and does not now — **not only the dead**. A fish you
rehomed lived here exactly as much as one that died here, and a section called
"Who lived here" that silently omitted it would be answering a different
question than the one on the heading. They are told apart plainly rather than
merged:

- **Remembered** — a memorial whose date falls inside a residency in this tank.
  Wing mark, the date, and a link to the memorial page.
- **Moved on** — a residency here that ended with no death in it. Says where
  they went when the next residency says, and links to the fish's record.
- A fish that lived here, left, and **died somewhere else later** is under
  *Moved on*, with a quiet line saying they were later remembered and a link.
  Filing it under *Remembered* here would attribute a death to a tank the fish
  had already left, which is exactly the class of false claim P6 forbids.

**A still-open residency can carry a memorial**, and that case is included on
purpose: a group of six that lost two is still resident, and those two died in
this tank. Keying the section on "the residency ended" alone would lose them.

## The rule lives in `domain/`, tested, like every other rule

`whoLivedHere` is a pure function of `(tankId, residencies, holdings, memorials,
specimens, aquariums)`. No clock, no database. The screen renders what it is
given and decides nothing, so what a test asserts and what a keeper sees cannot
drift — the same split spec 037 used for the timeline.

A memorial belongs to a residency when `startDate <= occurredOn` and either
the residency is open or `occurredOn <= endDate`. `recordDeath` closes the
residency on the death date when the last animal is gone, so the ordinary case
lands inside its own span at the boundary; the comparison is inclusive at both
ends for exactly that reason.

## Where P6 bites

A residency with no `endDate` and no memorial is a **current** resident and
never appears here — the tank already lists it above, and printing it under
"who lived here" would say it has gone.

Nothing is counted or totalled. There is no "3 lost" figure, no rate, and no
comparison between tanks: FR-L03 rules against turning a tank's dead into a
statistic, and a number like that is a scoreboard however gently it is worded.

## Not done here

- **Restructuring `/heaven` by tank.** See above.
- **A memorial for a tank itself.** A broken-down tank is retired, and spec
  013 already keeps its residencies intact.
- **Showing this on the shared public page.** A guest gets the tank as it is;
  who died in it is not theirs to read, and NFR-04's unsolved EXIF problem
  applies to any photograph that would come with it.

## Two things this found

**`summariseLife` could not name the tank of a fish that never moved.** Spec 046
read the tanks off the life events' `fromAquariumId` and `toAquariumId`, which
record only the **moves** — so a fish that lived in one tank its whole life had
no tanks at all and the memorial page silently omitted the row. That is most
fish. Residencies are what actually record where a fish lived; a move is the
transition between two of them. Found because criterion 8 needed that row and
it was not on the page.

**The heading was one letter from the one above it.** The tank's own grid is
headed *Who lives here*; this section is now *Who lived here before*. One
letter apart reads fine to whoever built it and not at all to somebody scanning
the page, and the added word keeps the name that was asked for.

## Acceptance criteria

Verified in a real browser against the built bundle at 390px, with a tank
seeded to hold all five shapes at once: an untouched resident, a fish that died
here, one that moved away, one that moved away and died elsewhere later, and a
group still resident that lost two.

1. A tank shows the fish that lived in it and no longer do. ✅ — 4 rows.
2. A fish that died in this tank appears under *Remembered*, with a wing mark
   and a link to its memorial. ✅ — wing mark present on that row only.
3. A fish that moved to another tank appears under *Moved on*, naming where it
   went, and links to its record. ✅ — "Moved to The 40".
4. A fish that left and died elsewhere is under *Moved on*, not *Remembered*,
   and still links to its memorial. ✅ — arrow rather than wing mark, and
   "Later remembered, Aug 1 2026".
5. A group that lost some but is still resident has those losses shown. ✅ —
   "Some of them are still in this tank."
6. A current resident with no memorial never appears. ✅
7. A tank nobody has left says so, gently, rather than showing an empty list. ✅
   — "Everyone who has lived in Quarantine is still here."
8. The memorial page's "Lived in" links to the tanks. ✅ — round trip followed
   through to the tank page.

And FR-L03: the rendered section was checked for a count, a rate or a total.
There is none.
