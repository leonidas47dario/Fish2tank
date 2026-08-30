# 019 — Every kept fish is a record you can open

**Status:** implemented.
**Date:** 2026-08-30.
**Touches:** FR-T01 (one record follows the fish), FR-T02 (an opening-balance holding has no specimen), FR-O05 (the raw label is never overwritten).
**Follows:** spec 005 change E, which put holdings into "Your fish" but left them unopenable.
**Feeds:** the Fish Heaven spec (PR #49), whose first open question is what identifies one fish.

---

## What was asked

> there seems to have a bug with prepopulated fish. for example, I could click
> into pineapple, whose is a catch profile. but I could not click into the 2nd
> one, which seems to be a unit and doesn't points me anywhere and doesn't let
> me edit the profile either. So I think the fix is that all kept fish are
> catches too, just tagged caught with a tank association/relationship. so
> rather than just a unit, it should really correspond to a catch log.

Two rows of the same species page behaved differently: `pineapple` opened a
record, `Super red severum ×1 / Peaceful Garden` opened nothing.

## Why the second row is dead

It is dead on purpose, and the purpose has expired.

`SpeciesDetail.tsx:479` renders a holding with no specimen behind it as a plain
`<div>`, with the reason stated inline: *"Not a link: there is no record to
open until a photo mints one."* That was true when spec 005 wrote it. The row
exists at all only because spec 005 change E5 noticed that a fish you keep but
never photographed was invisible on its own species page.

`Holding.specimenId` is optional by design under FR-T02, because an imported
inventory row records a fish you own without any encounter ever having
happened. `pineapple` has a specimen; the severum is one of the 61 rows of
`fish_inventory.xlsx`.

## The machinery already exists

`ensureSpecimenForHolding` (`repositories.ts:809`) mints *"the specimen a
holding always implied"*. It stamps `status: 'resident'` rather than
`encountered` — you did not meet this fish in a store, it is simply yours — and
routes the identity through `assertIdentity` with source `import`, so the raw
label travels verbatim and the answer to "how do we know what this is?" stays
auditable. It is idempotent.

Today it fires only when a photo is added. The whole of this spec is: fire it
when you open the row.

The destination is already worth arriving at. `SpecimenDetail` queries
`db.holdings.where('specimenId')` and renders placement as
`Peaceful Garden (×1)`, with move, add-to-another-tank, quantity adjustment and
identity all live.

Nor will the minted record be sealed by spec 005's hard block on unidentified
records. `SpeciesDetail` loads its holdings with
`db.holdings.where('speciesId').equals(id)`, so every row in "Your fish"
already has a species, and `ensureSpecimenForHolding` asserts it
`user-confirmed`.

## Decision: mint on open, not eagerly

Asked and answered before any code was written. The alternative was a migration
minting a specimen for all 61 existing holdings, which is the literal reading
of "all kept fish are catches too".

**Rejected because Home's "Recent catches" sorts every specimen by `createdAt`**
(`hooks.ts:109-114`). Sixty-one spreadsheet-labelled records dated the day of
the migration would bury the four fish actually caught, and the feed would have
to be redesigned in the same change to compensate.

Minting on open produces the same thing from the user's side — the row opens an
editable record — while holdings you never open stay unminted and the catch feed
keeps meaning what it says.

## The change

### 1. The row opens

`SpeciesDetail.tsx:479` becomes a `<button className="tankrow">` that calls
`ensureSpecimenForHolding(holding.id)` and navigates to `/specimen/:id`. The
same pattern `TankDetail.tsx:325` already uses for its editable tiles, so no
new route and no redirect component.

A stray tap therefore writes a record. That is acceptable: the record asserts
only that a fish you own exists, which was already true, the function is
idempotent so a second tap adds nothing, and `deleteCatch` can remove it.

### 2. Both row types carry the same three facts

A specimen row shows a name and a date; a holding row shows a name, a count and
a tank. So the moment you open `Super red severum ×1 / Peaceful Garden` it
crosses into the other list and loses its count and its tank — a regression
created by the fix itself.

Both row types get name, tank and count. Specimen rows keep their date, holding
rows keep "no photo yet".

Specimen to holdings is one-to-many, because "Also add to another tank" attaches
a second holding to the same specimen, so a specimen row sums its quantity
across its holdings and names each tank.

### 3. The photo target picker stops going quiet

`needsPhotoTarget` is `data.specimens.length === 0 && holdingsWithoutSpecimen.length > 1`
(`SpeciesDetail.tsx:181`). Opening one row makes the first clause false, and the
next photo then routes silently through `targetSpecimenId()` to the newest
specimen.

Concretely: two Congo Puffer holdings and no specimens. Open one to look at it,
then press "Add your photo" meaning the other. Today you get a picker. After
change 1, with no further change, the photo lands on the wrong fish and nothing
says so.

The condition becomes "more than one candidate exists", counting specimens and
unminted holdings together. That is what the control's own docstring already
claims: *"Only asked when it is genuinely ambiguous."*

### 4. `ensureSpecimenForHolding` says what it did

It currently logs nothing, and it is now reachable by a tap rather than only by
a deliberate photo upload. Per the logging standard it logs intent and outcome:
holding id, species id, whether it minted or returned an existing specimen, and
the resulting specimen id.

It also re-reads the holding after the transaction and throws if `specimenId`
was not written, rather than returning a specimen that nothing points at. A
mint that half-succeeds is otherwise invisible: the caller navigates to a real
record whose holding still shows "no photo yet" forever.

## Out of scope

- **`TankDetail.tsx:340`, the plain tile.** A different dead end: a holding with
  no `speciesId` at all, from an "unclear ID" import row. Opening it needs a way
  to identify a holding, which is its own piece of work.
- **Splitting an individual out of a group.** A ×3 holding mints one specimen
  with `kind: 'group'`, not three. Spec 005 deferred the unit model deliberately
  so the Breeder Tote's feeder guppies never expand into 50 records.
- **Eager backfill**, per the decision above.

## How this was tested, and the shape that forced

**This repo has no component tests and did not grow any here.** `vitest.config.ts`
sets `environment: 'node'` and includes only `*.test.ts`; there is no jsdom and
no testing-library in `package.json`. All 1,007 tests before this change are
pure. Spec 005's testing section promised component tests that were never
written, so that promise is not repeated.

The shape follows from it, and is the better shape anyway. Everything with a
decision in it moved into `src/domain/kept-fish.ts` as a pure function over
records, tested directly, matching how `domain/holdings.ts` already works. The
screen is left with markup and two calls.

What that leaves untested by the suite is the click wiring itself, so it was
verified in a real browser against the production build: a holding seeded with
a species, the row clicked, the record opened, the row re-read. The smoke
fixture could not do this — all 22 of its holdings have no `speciesId`, so none
of them reaches a species page at all.

```
ROWS BEFORE: ["Super red severum | Peaceful Garden | no photo yet"]
LANDED ON:   #/specimen/spec_5e79b2db-252a-4d4b-98c4-8c9229a12f2f
MINT LOGS:   [mint] specimen for holding { holdingId: hold_severum,
             speciesId: sp_green_severum, specimenId: spec_5e79b2db…,
             outcome: minted }
ROWS AFTER:  ["Super red severum | Peaceful Garden | 8/30/2026"]
CONSOLE ERRORS: []
```

The record it landed on carries identity ("Green Severum, you confirmed this"),
nickname, size and price, story chapters, and *If it comes home: Peaceful
Garden (×1)* with "Also add to another tank".

## Found while verifying, not fixed here

The minted record's header reads **"Caught 8/30/2026"** for a fish that was
never caught — the date is `Specimen.createdAt`, which is the minute the record
was minted. This is not new (`ensureSpecimenForHolding` has stamped it since
spec 005) but opening rows makes it common rather than rare.

It is the same finding the Fish Heaven spec records: *"The tempting default is
`holding.createdAt`. For the 61 imported inventory rows that is the minute a
spreadsheet was read in 2026 — it would render as 'together for 2 days' under a
photo of a fish kept for three years."* Fixing it means deciding whether
acquisition becomes a real field, which that spec lists as question 2 for the
catch redesign. Left alone deliberately rather than patched with another guess.

## Where this sits relative to Fish Heaven

The Fish Heaven spec is *"written to be built after the catch database
redesign"* and names four questions that redesign has to settle. This spec
answers a piece of the first — *"What identifies one fish. Today it is a
holding plus an optional specimen"* — by making the optional half reachable, so
a kept fish always **can** have a record even when it does not yet. It does not
make the specimen mandatory, and it does not touch questions 2, 3 or 4.

## Raised while designing this, deferred to its own spec

Verbatim, so the interpretation stays auditable:

> And next step (new feature) I do want to design the next step when a fish is
> brought home. From that point on, the fish is no longer just a profile, the
> fish is a unit in the inventory. it would allow the user to post updates (e.g:
> new photos and metrics) until the fish passes away. it would allow the user to
> cascade a timeline, date aquaired + 1month later +... + dead... etc; and after
> that, we will find a way to connect it to the new fish heaven design, spec
> should come up soon.

This is the unit model spec 005 deferred, now with a shape: a kept fish
accumulates dated updates — photos, measurements, notes — from acquisition to
death, rendered as a timeline, terminating in Fish Heaven.

Much of the substrate exists and should be checked before anything new is added:
`LifeEvent` is already dated and typed through `deceased`, `timeline()` in
`domain/holdings.ts` already orders events for one holding, `Media.capturedAt`
already dates photos, and `Memorial` already links a holding to Fish Heaven.
The gaps are metrics (there is no per-date size or weight record), a UI that
composes those four sources into one timeline, and the Fish Heaven redesign.

**It should be written together with the Fish Heaven spec, not after it.** That
spec's question 3 is the same question from the other end: *"Whether
measurements get a home over time. Size at acquisition versus size at death is
the degenerate two-point case of measurements over time … Worth considering
before FH-4 is built as two fields, because two fields are hard to migrate into
a series later."* A timeline of dated updates is exactly the series it is
asking for.

This spec is a precondition for both rather than a part of either: a fish with
no record cannot have a timeline.

## Acceptance criteria

1. A holding row in "Your fish" is an activatable control that mints and opens
   the record.
2. Minting is idempotent — opening the same row twice yields one specimen.
3. The minted specimen is `resident`, carries the holding's `rawLabel`, and has
   `user-confirmed` identity from source `import`.
4. Every "Your fish" row shows tank and count, whether or not a specimen exists.
5. The photo target picker appears whenever more than one candidate exists,
   including one specimen plus one unminted holding.
6. `ensureSpecimenForHolding` logs intent and outcome, and throws if the
   holding's `specimenId` was not written.
7. `vitest run` and `npm run build` both green. Spec 005 records that vitest
   does not typecheck, so the build is not optional.

All seven met. 1,020 tests across 57 files, up from 1,007 across 56; build
green; the browser run above covers 1, 4 and 5 end to end.

## Status

**Implemented.** Written and built in one pass, so this spec was finalised
after the work rather than before it; the design was agreed in conversation
first and the decision that shaped it (mint on open, not eagerly) is recorded
above as it was made.
