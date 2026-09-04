# 047 — A day holds one size, and a size can show its photograph

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-T02 (the kept fish), FR-J01 (the media is the record), P6.
**Builds on:** spec 037 (measurements), spec 046 (notes, editable rows).

---

## What was asked

> I'd like to make date a unique identifier for size as a way to update
> historical date. And if a measurement is associated with a photo, I should be
> able to click into the size to see the photo

With a screenshot showing one fish's History carrying **three measurements on
one day** — `1.5in`, `1.5in`, `4in`, all dated Sep 3 2026 — and no way to
remove or correct any of them.

## The problem behind it

`recordMeasurement` was `add`, unconditionally. Every save minted a new row, so
the form was **the only way to correct a measurement and it could not correct
anything** — a mistyped length produced a second row beside the first, and the
timeline then printed two contradictory sizes under one date with nothing to
say which was meant. There was no delete control on a measurement row either
(`deleteMeasurement` has existed since spec 037 and nothing ever called it), so
a wrong number was permanent.

That is worse than an inconvenience. A timeline that shows `1.5in` and `4in` on
the same day for the same fish is not reporting an ambiguity — it is reporting
something that did not happen. P6 forbids inventing a number; printing two
where one was measured is the same failure from the other direction.

## What "date is the unique identifier" means here

**A (holding, day) pair holds at most one measurement.** Recording a length for
a day that already has one replaces it, wholesale — length, photo link and note
together, because a note left attached to a number it was not written about is
a small lie of the same kind.

The form makes that legible rather than surprising: **choosing a date that
already has a measurement loads it**. The length, the unit, the photo it was
read from and the note all fill in, and the button says *Update the measurement*
rather than *Save measurement*. So the mechanism the keeper asked for — "a way
to update historical data" — is the thing the screen actually appears to do,
instead of a replace that happens invisibly on save.

Legacy duplicates collapse the first time a day is touched: the write replaces
**every** row for that day, so the three rows in the screenshot become one as
soon as Sep 3 is recorded again. Nothing sweeps the table on upgrade — a
migration that picked one of three numbers would be choosing on the keeper's
behalf which of them was true.

And a **Remove** control now sits on each measurement row, matching the one
spec 046 gave notes. Pruning a row should not require recording another.

### What a group loses, stated rather than glossed

Spec 037 allowed a group's measurement to be "one of them on that day", which
in principle permits several rows on one date for several individuals. That is
now one row per day for a group too.

The capability was not real. `HoldingMeasurement` names the **holding**, never
an individual, so two rows on one day for a group of six are unattributable —
nothing records which fish either belongs to, and the timeline reads exactly as
the screenshot does: contradictory sizes under one date. Recording per
individual needs an individual to record against, which is a much larger
feature (identity within a group) that nobody has asked for. Until then, one
honest row per day beats two the reader cannot resolve.

## Clicking a size to see its photograph

`HoldingMeasurement.mediaId` has recorded which photograph a size was read from
since spec 037, and nothing ever showed it. Where it is set, the size is now a
control: tapping it reveals that photograph inline, beneath the row.

- **Loaded on demand.** The blob is read only once the row is expanded, so a
  timeline of thirty measurements costs nothing until one is opened. It reads
  the `preview` rendition, not the original — spec 036's rule, since this is
  drawn at full column width and far above the 107 CSS px a thumbnail suits.
- **Both shapes get it.** A measurement whose photo was taken the same day is
  already drawn on the photograph's own row (spec 037 collapses the two); the
  size there is the same control. A measurement pointing at a photo from
  another day stays its own row and gets it too.
- **A size with no photo is plain text**, not a dead button. There is nothing
  to open, and a control that does nothing teaches the reader to stop tapping.

This is not the timeline photo-embedding request, which was explicitly dropped:
photographs do not appear in the timeline on their own. Only a size that names
one can show it, on request.

## Not done here

- **Embedding every photograph in the timeline.** Dropped by the keeper.
- **Backfilling a measurement's photo link.** The form sets `mediaId` when the
  measurement is written or updated; there is no separate "attach a photo to
  this old measurement" flow, and prefill-and-update covers the case.
- **A migration that dedupes existing rows.** See above — it would be picking
  which of three numbers was true.
- **Per-individual measurement within a group.** Needs identity within a group.

## Acceptance criteria

Verified in a real browser against the built bundle at 390px, seeded to
reproduce the reported state exactly: three sizes under Sep 3 2026, one
measurement naming a same-day photograph, one naming a photograph from another
day.

1. Recording a length for a day that already has one leaves exactly one
   measurement on that day. ✅
2. Several legacy rows on one day collapse to one when that day is recorded
   again. ✅ — `1.5, 1.5, 4` became `2.8`, and the other two days were
   untouched (`2026-08-15 → 3.2`, `2026-09-01 → 3.6`).
3. Choosing a date that already has a measurement prefills the form with it,
   and the button says so. ✅ — prefilled `4` (the newest of the three), button
   read *Update the measurement*, warning shown; moving to a date with nothing
   cleared the fields and the button read *Save measurement* again.
4. A measurement can be removed from its timeline row. ✅
5. A size that names a photograph reveals it when tapped, on its own row and on
   a same-day photograph's row. ✅
6. A size with no photograph is not a control. ✅ — 2 buttons, 3 plain sizes.
7. Nothing loads a photograph until a size is tapped. ✅ — **measured**, not
   assumed: `URL.createObjectURL` was counted, and the count moved by exactly
   one across the tap. The timeline read no blobs before it.
