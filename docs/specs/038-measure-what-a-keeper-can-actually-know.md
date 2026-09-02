# 038 — Measure what a keeper can actually know

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** ENH-12, FR-C05 (an estimate is marked as one), P6.
**Corrects:** spec 037's measurement form, on first use.

---

## What was asked

> I'd never know how heavy the fish is, it certainly is always length estimate.
> Note should be optional

Three corrections to a form that was one day old, and the first is one I had
already asked about and got the wrong answer to.

## Weight was a question I asked and then mis-read the answer to

Spec 034's third open question was, in full:

> **Length only, or weight too?** Weight needs a scale and a wet fish. I have
> included it optionally, but if nobody will ever record one, the field is
> clutter that will still be in the schema in a year.

The answer was *"Yes it would be"*, so it was built as a peer of length —
same prominence, same row. With the form actually in front of them, the
keeper's position is *"I'd never know how heavy the fish is."*

Those are not contradictory. **"Yes, record weight" and "I will never measure
one" are both true**: weight is worth having when someone has a figure, and
that will be rare. What was wrong was the form treating a field nobody will
usually fill as equal to the one they always will.

So weight moves behind a disclosure — present, unchanged, and out of the way.

**The field stays in the schema**, and that is deliberate rather than lazy:
`holdingMeasurements` is a synced table, FR-A06 records that Dexie cannot
migrate one consistently on the client, and removing a property to save a line
of a form would be spending a real constraint on a cosmetic gain. It costs
nothing where it now sits.

## An estimate is the normal case, so it is the default

*"It certainly is always length estimate."* True, and the form had it
backwards: `estimate` was an unchecked box, so the default reading of every
measurement was "measured", and the honest answer needed an extra action.

A fish is measured through glass, in water, while it moves. **Estimate is now
the default**, and the box is there to say *"no, I actually measured this"* —
against a ruler, or a fish out of water on a wet towel.

This is FR-C05 pointing the way it was always meant to: an eyeballed figure
must never pass as a measured one. A default that quietly claimed precision
nobody had was the exact failure the requirement exists to prevent — and it
would have mislabelled every measurement the keeper ever took.

## The optional fields say so

The note was already optional in the schema and in `recordMeasurement`; nothing
rejected an empty one. But a bare label reads as required, and a form that
looks like it wants five answers when it needs one is a form people abandon.

Every optional field is now labelled. What is actually required is one of
length or weight, which the save button has enforced since spec 037.

## Not done

- **Removing `weight` from the schema.** Above.
- **Length-only quick entry from the timeline.** Tempting, and it is a
  different change: the form is now short enough that the case for a second
  path is weaker than it was an hour ago.

## Acceptance criteria

1. Length is the first and only field a keeper must think about. ✅
2. Weight is reachable but not in the way. ✅
3. A new measurement is an estimate unless the keeper says otherwise. ✅
4. Every optional field is labelled optional. ✅
5. A measurement recorded as estimated still renders "(est.)". ✅
6. `vitest run` and `npm run build` green. ✅
