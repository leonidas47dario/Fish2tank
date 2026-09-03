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

So weight is **removed**, field and all.

### The first version of this spec kept the field, on an argument that was wrong

It said:

> The field stays in the schema … `holdingMeasurements` is a synced table,
> FR-A06 records that Dexie cannot migrate one consistently on the client, and
> removing a property to save a line of a form would be spending a real
> constraint on a cosmetic gain.

The keeper's reply was *"So you're keeping an empty column to avoid a schema
change? Why can't we just drop that column?"* — and they are right. Checked
against FR-A06's actual wording rather than my memory of it:

> Dexie's own documentation states that **migrations cannot be performed
> consistently on the client once a table is synced.** Every schema change must
> land before sync is switched on.

That governs `version()` bumps — tables and **indexes**. `weight` is neither: it
is an unindexed optional property, and Dexie stores whatever object it is
handed. Removing it from the interface needs no version, no upgrade function
and no migration. **There was no constraint to spend.** I invoked a real rule
to defend a field I had already been told was useless, which is worse than
simply having built the wrong thing.

The only residue is that a row written in the last few hours may carry a
`weight` property nothing reads. That is inert data in a UAT database, not a
migration.

`WeightUnit`, `WeightMeasurement` and `formatWeight` go with it; they existed
solely for this.

## The estimate toggle is gone, and inverting it is what showed why

*"It certainly is always length estimate."*

The first pass took that as a default: flip the box so a new measurement is an
estimate unless the keeper says otherwise. That was better and still wrong, and
the keeper's follow-up — *"estimate toggle is redundant, remove completely"* —
names the reason inverting it had already demonstrated.

**If the answer is always the same, the question is not worth asking.** Every
one of these is eyeballed through glass, in water, on a moving fish. A flag
that is always true distinguishes nothing; it just costs a decision on every
entry and adds "(est.)" to every row, which is noise rather than information.

FR-C05 is not weakened. It says an estimate must never pass as a measurement —
and nothing here now claims to be a measurement. The requirement is satisfied
by the app not making the claim, rather than by a marker on every record
saying it is not making it. `Measurement.estimate` still exists on the generic
and is still used by `observedSize`, where the distinction is real because that
figure sometimes comes off a store's tag.

## The optional fields say so

The note was already optional in the schema and in `recordMeasurement`; nothing
rejected an empty one. But a bare label reads as required, and a form that
looks like it wants five answers when it needs one is a form people abandon.

Every optional field is now labelled. What is actually required is one of
length or weight, which the save button has enforced since spec 037.

## Not done

- **Rewriting rows that already carry a `weight`.** Nothing reads the property;
  a migration to delete a key nobody looks at would be motion, not work.
- **Length-only quick entry from the timeline.** The form is now three fields,
  two of them optional, so the case for a second path is weaker than it was.

## Acceptance criteria

1. Length is the only measure the form asks for. ✅
2. Weight is gone: no field, no type, no formatter. ✅
3. No estimate toggle. ✅
4. Every optional field is labelled optional. ✅
5. Recording a measurement with no length is refused. ✅
6. `vitest run` and `npm run build` green. ✅
