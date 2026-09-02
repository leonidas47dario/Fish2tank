# 037 — A kept fish is a timeline, and Fish Heaven is where one ends

**Status:** design settled; built in two parts, this PR being the first.
**Date:** 2026-09-02.
**Touches:** ENH-12, ENH-18 (Fish Heaven), FR-L02/L03/L04, FR-T02/T03,
FR-A06 (schema changes must be additive), P6 (never invent a number).
**Supersedes:** the two proposals in PR #71 (spec 034) and PR #49 (spec 030),
whose reasoning is carried into this document rather than left in a closed
pull request.

---

## Why one document

Both proposals ended on questions, and #49's were explicitly questions for
whoever designed the timeline:

> **Whether measurements get a home over time.** *Size at acquisition versus
> size at death* is the degenerate two-point case of "measurements over time".
> … **Worth considering before FH-4 is built as two fields**, because two
> fields are hard to migrate into a series later.

Asked which should go first, the answer was:

> 71+49 need to be designed together

That is the right call, and it is not a scheduling preference. Fish Heaven
built alone grows two columns on a memorial; the timeline built alone leaves
Fish Heaven as a second store of facts about the same fish. Designed together,
**FH-4 stops being a feature and becomes a query** — the first and last
measurement of a holding — and Fish Heaven becomes the index of timelines that
ended. One design, two pull requests, in the order below.

## The three decisions, as given

> 1. Yes if it's a group with a unit tag, they'd share the same timeline.
> 2. Yes it would be
> 3. Okay

Answering, in order: **the unit is the holding** and a group shares one
timeline, provided the group is visibly tagged as one; **weight is recorded as
well as length**; **a measurement may attach to a photo.**

Everything below follows from those three, and each is load-bearing rather
than decorative.

## What already exists, measured

More than "a major redesign" suggests. Four dated sources are in the schema and
three are already written by the app:

| Source | Dated by | Status |
|---|---|---|
| `LifeEvent` | `occurredOn` | **Written** — 12 types, `acquired` through `deceased`, with `quantityDelta`, tank moves and notes |
| `Media` | `capturedAt` | **Written** — every photo is already a dated observation |
| `Memorial` | `occurredOn` | **Written** — story, lesson, suspected contributors, confidence |
| `timeline()` | — | **Exists** in `domain/holdings.ts`, and already orders one holding's life events |

So the gap is one new record type and one view. **Every existing collection
gets a partial timeline the day this ships**, with nobody entering anything,
because the photos and life events are already there and already dated. That
matters more than it sounds: a feature that starts empty is a feature nobody
adopts.

## The one genuinely missing record

Nothing anywhere records a size or a weight against a date. `adultSize` on a
species is a catalog fact about the *kind* of fish, not an observation of
yours; `observedSize` on an encounter is a single note at the moment of
meeting, not a series.

### It cannot be called `Measurement`

`domain/types.ts` already exports

```ts
export interface Measurement<U extends string> { value: number; unit: U; estimate?: boolean }
```

which is the generic behind `LengthMeasurement` and `VolumeMeasurement`. PR
#71's proposal named the new record `Measurement` and would have collided with
it on the first import. The record is **`HoldingMeasurement`**, and this
paragraph exists so nobody later "simplifies" the name and breaks the generic.

```ts
export type WeightUnit = 'g' | 'oz';
export type WeightMeasurement = Measurement<WeightUnit>;

export interface HoldingMeasurement {
  id: Id;
  holdingId: Id;
  observedOn: CalendarDate;
  length?: LengthMeasurement;
  weight?: WeightMeasurement;
  /** Decision 3: the photo this was measured from, when there is one. */
  mediaId?: Id;
  note?: string;
  createdAt: Instant;
}
```

Both measures optional, because a keeper who eyeballs a length must not be
blocked by owning no scale — and `Measurement.estimate` already exists to say
which it was, so an eyeballed 3 inches never masquerades as a measured one.

### Weight is in because it was asked for, and it changes nothing structurally

Decision 2. Reusing the existing generic means `WeightMeasurement` carries its
own unit, so grams and ounces coexist without a normalisation step at the call
site, exactly as `in`/`cm` already do.

### A measurement attaches to a photo, optionally

Decision 3. `mediaId` is optional and one-way: the measurement names the photo,
the photo knows nothing about it. That keeps `Media` untouched — it is the most
load-bearing table in the app and the one spec 036 has just been through.

The payoff is in the view rather than the schema: a photo in the timeline can
carry *"2.8 in"* beside it, and deleting a photo (spec 033) must therefore
clear the link rather than orphan it. **That cascade is a requirement, not an
implementation detail**, and it is in the acceptance criteria.

## The unit is the holding, and a group says so

Decision 1, and it settles the first of #49's four deferred questions:
*what identifies one fish.*

`LifeEvent`, `Memorial` and `Residency` all key on `holdingId` already. Keying
a timeline on anything else means translating three populated tables to gain
nothing today.

The cost is real and was accepted knowingly: **a holding can be a group.**
`kind` is `'individual' | 'group'`, and the inventory import produces
`Super red severum ×3`. A timeline of "this fish" for three severums is
honestly a timeline of *those three* — one acquisition, one tank history, and a
`quantityDelta` when one of them dies.

"With a unit tag" is the condition attached to the answer, so it is a
requirement rather than a nicety:

- a group's timeline carries a **visible count** — `×3` — at the head, so the
  reader is never guessing whether a page is about one animal or several;
- the prose follows the data: a group is **"these three"**, never **"it"**;
- a measurement on a group is a measurement of *one of them* on that day. The
  form says so, and the timeline never averages several into a single figure.
  Averaging would be inventing a number about an animal nobody measured.

**Splitting a group into individuals stays out of scope** and is the natural
follow-up. Doing it here doubles the work and forces a migration on the 61
imported rows before anyone has asked for one.

## Acquisition becomes a real field

This settles #49's second deferred question, which it had already predicted the
answer to:

> **The catch redesign could remove this ladder entirely** by making
> acquisition a first-class field. That would be a strictly better answer than
> deriving one.

So `Holding` gains `acquiredOn?: CalendarDate`. It is an optional property on
an existing table with **no new index**, which is additive in the sense FR-A06
requires — Dexie stores what it is given per record, and only an index change
needs a version bump.

The derivation ladder does not disappear, because 61 imported rows will never
have the field. It gains a first rung and loses its worst temptation:

1. `holding.acquiredOn` — what the keeper actually recorded
2. an `acquired` life event's `occurredOn` — a real date somebody entered
3. the earliest `capturedAt` among its photos — **a lower bound, labelled as
   one**: *"photographed since March"*, never *"acquired in March"*
4. otherwise **no relative labels at all**, absolute dates only

`holding.createdAt` is **never** used, at any rung. For the imported rows it is
the minute a spreadsheet was read in 2026, so a fish kept three years renders
"together for 2 days" — a plausible-looking number that is simply false, which
is the exact shape P6 forbids.

## The view

One merged, dated stream per holding, composed from four sources with no new
storage:

```
Acquired · 3 Jan            LifeEvent
Photo · 3 Jan               Media.capturedAt
2.1 in · 14 Feb             HoldingMeasurement
Moved to Peaceful Garden    LifeEvent (fromAquariumId → toAquariumId)
Photo · 2 Mar   — 2.6 in    Media + HoldingMeasurement.mediaId
Deceased · 19 Apr           LifeEvent + Memorial
```

It is a section on the record spec 019 made openable, **not a replacement for
it**. "Stops being a profile" is about emphasis, not deletion.

## Fish Heaven, and what designing together buys

The requirements from #49 stand as written — FH-1 through FH-7 — with two
rewritten by this design rather than merely informed by it.

**FH-4 stops being two columns.** *Size at acquisition versus size at death*
becomes the first and last `HoldingMeasurement` for the holding. Growth appears
only when both exist, mixed units compare correctly through the existing
conversion, and the memorial page gets a series for free the day someone
records a second measurement. Nothing needs migrating later, which was the
whole reason for asking the question first.

**FH-3 reads `acquiredOn`** rather than deriving, falling back to the ladder
above for imported rows.

The remaining two deferred questions settle without argument. *Does "deceased"
stay a life event?* — **yes**; FH-7's delete rule depends on the death record
and the memorial being separable, and nothing here needs them merged. *What
identifies one fish?* — the holding, above.

And the connection the original ask reached for falls out rather than being
built: **Fish Heaven is the index of timelines that ended.** A memorial page is
a holding's timeline with a beginning, an end, and the memorial's own words
attached — not a parallel store of facts about dead fish.

## Two pull requests, in this order

**This PR — the spine.** `HoldingMeasurement`, `Holding.acquiredOn`, the
repository functions, the merged timeline as a pure domain function with tests,
the timeline section on a holding's record, **and the form that writes one**.

The form was nearly left out, on the reasoning that the spine is the read path.
That would have shipped a review round in which the headline of the ask —
*"post dated updates (new photos, metrics)"* — could not be exercised at all,
because `recordMeasurement` existed, was tested, and was called by nothing. A
repository function no screen reaches is not a feature.

**Next — Fish Heaven** rebuilt on it: the `/heaven` route, the memorial page,
memos, photos, edit and delete, per FH-1…FH-7.

Splitting this way is not a hedge. The spine is independently useful — a
timeline on every existing record, with no data entry — and Fish Heaven built
on top of it needs no schema of its own.

## What a new table drags with it

Spec 030 warned that a new table "would need its own sync entry, sweep rule and
backup coverage". Checked rather than assumed, that is a precise list of four
places, all of them in this PR:

| | |
|---|---|
| `db.ts` | an `EntityTable` and `version(6).stores({ holdingMeasurements: 'id, holdingId, observedOn, mediaId' })` — a pure addition, like v2, v3 and v5, so no upgrade function |
| `portability/manifest.ts` | `EXPORTED_TABLES`, or a backup silently loses every measurement |
| `portability/erase.ts` | `ERASED_TABLES`, or "erase everything" leaves them behind |
| sync | **nothing to do** — it is absent from `UNSYNCED_TABLES`, so it syncs like `lifeEvents`, which is correct: these are small records, not megabytes |

There is no blob involved, so BUG-06's orphan sweep is untouched.

## Deliberately not here

- **Splitting a group into individuals.** The natural next step; nothing above
  needs it to be true.
- **Growth charts.** Two measurements are a line, not a chart. The dataviz
  question deserves its own thinking once real series exist.
- **Automatic measurement from a photo.** No.
- **A shared or public memorial page.** That is the tank-sharing request and it
  carries an unsolved EXIF problem: NFR-04 requires stripping EXIF from shared
  derivatives, the app strips none today, and stored originals may carry home
  GPS coordinates.
- **Bereavement prompts, anniversaries or notifications.** Nobody asked to be
  reminded, and FR-L03's tone rules against it.

## Acceptance criteria

### Found while building, worth keeping

Two things the design did not predict, both caught by driving it in a browser
rather than by a test that agreed with itself.

**`Measurement` was already taken.** PR #71's proposal named the new record
`Measurement`, which is the existing generic behind `LengthMeasurement` and
`VolumeMeasurement`. It is `HoldingMeasurement`, and the type carries a comment
saying why so nobody shortens it back.

**Pairing a measurement to a photo needs a same-day condition.** The design
said a photo's row can carry its measurement beside it, which is right when the
two happened together and wrong the rest of the time: `mediaId` is just a link,
and nothing stops the photo being months older. The first browser run showed
exactly that — a measurement observed on 4 April rendered under a photo dated
2 September. Drawing it there prints a size under a date on which nobody
measured anything, which is the untruth P6 forbids arrived at by a layout
decision. They now pair only on a matching day, and otherwise stay two rows
under their own dates. The rule lives in the domain function with a test.

### The spine, this PR

1. A `HoldingMeasurement` records a length, a weight, or both, against a date
   and a holding, **from the app**. ✅ (browser)
2. Either measure alone is valid; neither is not — and the form disables
   saving rather than letting someone discover that by pressing it. ✅
3. A measurement may name a photo — chosen by date in the form — and
   **deleting that photo clears the link rather than orphaning it**. ✅
4. Deleting a catch or a holding takes its measurements with it. ✅ (both paths cascade through `removeHolding`)
5. A holding's record shows one merged, dated stream of life events, photos,
   measurements and its memorial. ✅ (browser)
6. Existing collections show a timeline with nobody entering anything. ✅ (browser: a fish with only a photo)
7. Relative labels appear only when an honest anchor exists, and say
   "photographed since" when the anchor is a photograph. ✅ (browser)
8. `holding.createdAt` is never an acquisition date, at any rung. ✅
9. A group's timeline shows its count and never says "it". ✅ (browser: `History ×3`, "these 3 fish")
10. A measurement on a group is never presented as an average. ✅ (each reads "one of them")
11. The new table is exported, erased, and synced. ✅
12. The schema change is purely additive. ✅ (`version(6)`, no upgrade function)

### Fish Heaven, the next PR

FH-1 through FH-7 as written in PR #49, with FH-4 reading the measurement
series and FH-3 reading `acquiredOn`.
