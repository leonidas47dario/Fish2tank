# 007 - One searchable species corpus

**Status:** designed, being built
**Date:** 2026-08-30
**Touches:** FR-I02 (manual species search), FR-I06 (preserve identification history — its acceptance criterion is *changing* an identification), FR-I01 (Unknown / Provisional / User Confirmed).
**Closes:** BUG-01, in the narrower form measured below.
**Introduces:** a single searchable corpus both identify surfaces read, rather than two libraries that each miss something.

---

## What was asked

BUG-01 as filed says identification search cannot see the catalog. The
measurement below says that was true when it was filed and is now true of
exactly one of the two screens that search for a species.

## The problem behind it

There are two species libraries in this app and neither is complete.

| Library | Rows | Holds |
|---|---|---|
| `CATALOG.species` (`marts/catalog.json`) | 2,176 | Every species derived from vendor listings. No user submissions. |
| `db.species` (IndexedDB) | 47 + submissions | The curated care profiles seeded at first run, plus any species this keeper typed in. |

Two screens let you attach a species to a specimen, and they read different
libraries:

- **Capture → identify** (`IdentifyFlow.tsx`) calls `identifyFromText(query, CATALOG.species)`. Ranked, 2,176 species, tells you which field matched.
- **Specimen → Identity → Change** (`IdentityPanel` in `SpecimenDetail.tsx`) calls `searchSpecies`, a `.includes()` filter over `db.species`. Unranked, **47 species**.

So the guided flow was fixed at some point and the other one was not. Correcting
a misidentified fish — FR-I06's own worked example, "changing jaguar cichlid to
dovii" — can only reach the 47 species that happen to have a hand-written care
profile. For the other 2,129 the search returns nothing and the user has no way
to tell whether the fish is absent or the search is.

**This is the more damaging half of the two.** A wrong identity is a record
that is actively lying, and this is the only screen that can repair one.

## The trap in the obvious fix

Pointing `IdentityPanel` at `CATALOG.species` trades one gap for another.

`db.species` is not just the 47. It is also where `submitUserSpecies()` writes
a species the keeper typed in when the catalog had never heard of it —
`sp_user_*`, `origin: 'user-submitted'`. Those rows exist in no mart. Today the
panel can find them, because it searches the table they live in. A naive switch
to the catalog gains 2,129 species and silently loses the keeper's own.

So the fix is not "use the other library." It is: **stop having two.**

## The decision

One corpus, built once, read by both screens:

```
CATALOG.species  ++  db.species where origin === 'user-submitted'
                     (adapted through catalogShapeForLocal)
```

`catalogShapeForLocal()` already exists in `src/data/catalog.ts` and was written
for precisely this — presenting a locally-submitted species in the catalog's
shape with every unsourced field deliberately absent, so "not enough data"
renders honestly instead of a shape full of zeroes.

Both screens then rank with the same `identifyFromText()`. The panel gains
ranking and match-provenance it never had; the capture flow gains the keeper's
own submissions, which it also could not see.

**Measured, because the swap is only safe if it loses nothing.** The 47 seeded
species could have carried ids of their own, in which case dropping `db.species`
from the corpus would strand every specimen already identified through the old
panel. They do not: all 47 seeded ids (`entry('sp_…')` in `species-catalog.ts`)
are present in `catalog.json` under the same id — the ETL adopts the curated id
where one exists, so `sp_jaguar_cichlid` is a mart row rather than
`sp_parachromis_managuensis`. The new corpus is therefore a strict superset of
what the panel can reach today, and no stored `speciesId` changes meaning.

`searchSpecies()` loses its only caller and is deleted rather than left as a
second way to do this that drifts from the first. `src/data/catalog.ts` already
carries that warning in its own comments: "the Catalog exists precisely because
a second screen doing the same derivation drifts from the first."

## A second defect this surfaced

`submitUserSpecies()` records a user-submitted species as **provisional**, on
deliberate reasoning kept in its comment:

> Provisional, never user-confirmed: confirming means "this is that catalog
> species", and there is no catalog species to mean.

`IdentityPanel.confirm()` asserts `user-confirmed` unconditionally. Because
user-submitted rows are in `db.species`, the panel can already find one and
promote it to a confirmation of a species that does not exist in any shared
catalog — contradicting the rule one function over, today, with no change from
this spec.

Keeping the corpus honest means the call site has to respect that rule, so it
now asserts `provisional` when the chosen id is user-submitted
(`isUserSubmittedId()`, which also already exists). One line. Recorded here
because it is a behaviour change beyond the search, and a reviewer should get
to disagree with it.

## The catalog's size is misstated in sixteen places

Measured: `catalog.json` holds **2,176** species (2,176 distinct ids, built
2026-08-29). What the repo says:

| Says | Where | Off by |
|---|---|---|
| "2,178 species" | 14 code comments across `src/ui` and `src/data` | 2 |
| "1,080-species mart" | `docs/BACKLOG.md` BUG-01 | 1,096 |
| "1,080+ cards" | `docs/BACKLOG.md` ENH-03 | 1,096 |

**Every one of the 14 is a code comment. None is user-facing.** An earlier draft
of this spec claimed `IdentifyFlow.tsx:271` was rendered copy; it is inside a
`{/* */}` block. Nothing in the running app states a species count, so there is
no wrong number in front of the user and no count to compute from the data.

Scope, therefore: correct the one comment in the file this change already edits,
correct the two backlog rows (which are wrong by a thousand, not by two), and
file the remaining 13 against **FR-D09**, the drift guard that already exists in
the backlog for exactly this failure and would have caught all of them. Rewriting
13 comments in files this change does not otherwise touch would be churn, and it
would not stop the seventeenth.

## Out of scope

- **An escape hatch on the Change panel.** The capture flow has "log it as is"
  for a fish the catalog lacks; the panel has none, so correcting a fish *to* a
  species the catalog has never heard of is still impossible. That is a real
  gap, it is a new affordance rather than a repair, and it deserves its own
  argument. Filed, not built.
- **Merging the two libraries properly.** `db.species` holding 47 care profiles
  while the mart holds 2,176 rows with backfilled care is its own untangling.
  This spec makes them one *searchable* corpus, not one *storage* model.
- **BUG-02's 21 synonym pairs**, which put the same fish in the corpus twice
  under two names. Unchanged here, and now visible in one more place.

## Acceptance criteria

1. Searching the specimen Identity panel for a species that is in the catalog
   but has no seeded care profile returns it. `Erythrinus erythrinus`
   ("Rainbow Wolf Fish", BUG-01's own reproduction case) is the test.
2. Searching either surface for a species the keeper submitted returns it.
3. The corpus contains every catalog species and every user-submitted species,
   and no seeded-catalog duplicate of a species already in the mart.
4. Confirming a catalog species from the panel records `user-confirmed`;
   confirming a user-submitted one records `provisional`.
5. Both surfaces rank with `identifyFromText`, so the same query yields the same
   ordering on each.
6. `searchSpecies` no longer exists.
7. The catalog size stated in the file this change edits, and in the two backlog
   rows, matches the measured 2,176; the remaining 13 stale comments are filed
   against FR-D09 rather than hand-corrected.
