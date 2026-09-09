# 034 — A kept fish is a timeline, not a profile

**Status:** PROPOSAL. Requirements and a design, no code. Asked for as a
proposal, and it deserves argument before it becomes a schema.
**Date:** 2026-09-01.
**Touches:** ENH-12, FR-T01 (one record follows the fish), FR-A06 (schema
changes must be additive), P6 (never invent a number).
**Feeds:** spec 030, Fish Heaven — which should be built *after* this, for a
reason argued below.

---

## What was asked

> Once a fish is brought home it stops being a profile and becomes a unit in
> the inventory: post dated updates (new photos, metrics) from acquisition
> until it dies, rendered as a cascading timeline (acquired, +1 month, …,
> deceased), then connected to the redesigned Fish Heaven

## What already exists, measured

More than it looks. Four dated sources are already in the schema and three of
them are already written by the app:

| Source | Dated by | Status |
|---|---|---|
| `LifeEvent` | `occurredOn` | **Written.** 12 types, `acquired` through `deceased`, with `quantityDelta`, tank moves and notes |
| `Media` | `capturedAt` | **Written.** Every photo is already a dated observation |
| `Memorial` | `occurredOn` | **Written.** Story, lesson, suspected causes, confidence |
| `timeline()` | — | **Exists**, in `domain/holdings.ts`, and already orders one holding's events |

**The gap is narrower than "a major redesign" suggests.** Three of the four
feeds exist and are populated. What is missing is one new record type and one
view.

## The one genuinely missing record: a measurement

Nothing anywhere records a size or a weight against a date. `adultSize` on a
species is a catalog fact about the kind of fish, not an observation of yours.
So "metrics over time" has no substrate at all, and this is the piece that has
to be designed rather than assembled.

```ts
export interface Measurement {
  id: Id;
  holdingId: Id;
  observedOn: CalendarDate;
  length?: LengthMeasurement;   // reuses the existing unit-carrying type
  weight?: WeightMeasurement;   // new; grams or ounces, same shape
  note?: string;
  createdAt: Instant;
}
```

**Keyed on `holdingId`, not `specimenId`**, to match `LifeEvent` and `Memorial`
— see the next section. **Purely additive**, a new table, because FR-A06
records that Dexie cannot migrate a synced table consistently on the client.
Both fields optional because a keeper who eyeballs a length should not be
blocked by having no scale.

## The decision everything else hangs on: what is a "unit"?

The ask says a fish "becomes a unit". The app has two candidates and they are
not interchangeable.

**I propose the holding**, and it is worth being explicit about the cost.

`LifeEvent`, `Memorial` and `Residency` all already key on `holdingId`. A
timeline keyed on anything else would need every one of them translated, and
would fight the grain of three existing tables to gain nothing today.

The cost is real: **a holding can be a group.** `kind` is
`'individual' | 'group'` and the inventory import produces
`Super red severum ×3`. A timeline of "this fish" for a group of three is
honestly a timeline of *these three* — one acquisition, one tank history, and a
`quantityDelta` when one dies. That is a true record of a unit you manage, and
it is not a record of an individual animal.

So the language must follow the data: a group's timeline says *"these three"*
and never *"it"*. Pretending otherwise would be P6 applied to prose.

**Splitting a group into individuals is deliberately out of scope** and is the
natural follow-up. Doing it here would double the work and force a migration on
the 61 imported rows before anyone has asked for one.

## The view

One merged, dated stream per holding, newest first, composed from the four
sources — no new storage, just a join:

```
Acquired · 3 Jan            (LifeEvent)
Photo · 3 Jan               (Media.capturedAt)
2.1 in · 14 Feb             (Measurement)
Moved to Peaceful Garden    (LifeEvent, fromAquariumId → toAquariumId)
Photo · 2 Mar
2.8 in · 4 Apr
Deceased · 19 Apr           (LifeEvent + Memorial)
```

Because photos are already dated, **every existing collection gets a partial
timeline for free** the day this ships. That matters: a feature that starts
empty is a feature nobody adopts.

### The "+1 month" labels need care, and this is where P6 bites

Relative labels require an acquisition date, and the honest one is often
missing. Spec 030 already found this trap: `holding.createdAt` for the 61
imported rows is *the minute a spreadsheet was read in 2026*, so a fish kept
three years would render "together for 2 days" under its photo.

So relative labels come from an **evidence ladder**, and the last rung is
silence:

1. An `acquired` life event's `occurredOn` — a real date somebody entered
2. The earliest `capturedAt` among its photos — a lower bound, labelled as one
   ("photographed since March", never "acquired in March")
3. Otherwise **no relative labels at all**. Absolute dates only.

`holding.createdAt` is **never** used for this. It is a database fact, not a
fish fact, and it is exactly the kind of plausible-looking number P6 forbids.

## Why this should come before Fish Heaven (spec 030)

Spec 030 wants "size at acquisition versus size at death". That is the
degenerate two-point case of a measurement series.

Ship it as two columns on a memorial and the migration into a series afterwards
is painful — and FR-A06 makes it worse, because a synced table cannot be
migrated on the client. Ship measurements first and FH-4 becomes a query over
data that already exists: first and last `Measurement` for the holding.

**Fish Heaven then becomes the index of timelines that ended**, rather than a
second, parallel store of facts about dead fish. That is the connection the ask
asks for, and it falls out rather than being built.

## Deliberately not in this proposal

- **Splitting a group into individuals.** The natural next step; not needed to
  make any of the above true.
- **Growth charts.** Two measurements are a line, not a chart, and the dataviz
  question deserves its own thinking once real series exist.
- **Automatic measurement from photos.** No.
- **Changing what `SpecimenDetail` is.** The timeline is a section on the
  record spec 019 made openable, not a replacement for it. "Stops being a
  profile" is about emphasis, not deletion.

## Open questions I should not answer alone

1. **Does a group timeline feel right, or is splitting into individuals the
   thing you actually want?** I have proposed the holding because it fits the
   data; if a per-animal record is the real ask, that reverses the order of the
   next two pieces of work.
2. **Length only, or weight too?** Weight needs a scale and a wet fish. I have
   included it optionally, but if nobody will ever record one, the field is
   clutter that will still be in the schema in a year.
3. **Should a measurement be attachable to a photo?** "This is 2.8 in" is often
   said *about* a picture. Linking them is cheap now and awkward later.

## Acceptance criteria, when this is built

1. A `Measurement` can be recorded against a holding, with a date, and either
   a length or a weight or both.
2. A holding's record shows one merged, dated stream of events, photos,
   measurements and its memorial.
3. Existing collections show a timeline built from photos and life events
   without anyone entering anything.
4. Relative labels appear only when an honest anchor exists, and are labelled
   as a lower bound when derived from a photo.
5. `holding.createdAt` is never used as an acquisition date.
6. A group's timeline never refers to "it".
7. The schema change is purely additive.
