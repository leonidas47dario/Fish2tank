# 065 — The portraits the app can actually draw

## What was asked

> just scanning makes me feel like there are more profiles without pic than
> just 8%. can you double check?

He was right. The figure I had reported — 92.9% — was wrong, and the way it was
wrong is the interesting part.

## The bug

A portrait appears only when **two** things are true. `chooseArt` in
`src/data/catalog.ts`:

```ts
const src = species ? portraitAsset(species.speciesId) : undefined;
if (src && species?.portrait) {
  return { kind: 'portrait', src, credit: species.portrait };
}
```

`portraitAsset` answers "is there a **file**". `species.portrait` is the
**mart row** that carries the credit line. Spec 058 added 1,015 image rows and
spec 062's run downloaded 1,015 files — and **the mart was never rebuilt**.

Measured against `uat` before this change:

```
species in catalog          2155
have a portrait FILE        2003   92.9%   ← what I measured and reported
have a portrait ROW         989    45.9%   ← what the app actually draws

FILE but NO mart row        1014
```

`catalog.json` was built **2026-09-04**, before spec 058 existed. So 1,014
portraits shipped in the build, were served by the tail route, and drew nothing.
Coverage was still 45.9%, which is exactly what scanning the catalog looked
like.

**I measured the wrong thing and stated it as the result** — in the commit, in
PR #114, and in the report. Files on disk are not portraits on screen, and the
gap between them is the entire subject of this spec.

## Why nobody ran `npm run marts`

Not an oversight so much as a missing route. `build-marts.ts` reads
`warehouse/dim/dim_image.parquet`, and rebuilding the warehouse **refuses to
start** without `data/market/listings.jsonl`:

```
Error: data/market/listings.jsonl not found - run "npm run etl" first.
```

That file is gitignored — it is 10 MB and rebuilds from the warehouse itself.
So the only documented path from "new portraits on disk" to "portraits the app
draws" ran through a **vendor scrape that has nothing to do with portraits**.
A step that expensive and that unrelated does not get run.

## What changes

### 1. A portrait run can reach the mart without a vendor scrape

`npm run reimage` rebuilds `dim_image` alone and writes the parquet. Two
commands then take a portrait run all the way to the app:

```
npm run reimage && npm run marts
```

The SQL is `buildDimImage`, shared with `build-warehouse.ts` rather than copied,
because two definitions of one table is how a rebuilt dimension quietly ends up
a column short.

**It lives in a new `etl/warehouse-dims.ts`, and that is not tidiness.**
`build-warehouse.ts` calls `main()` at import time — `images-jsonl.ts` already
carries the warning *"that module calls main() at import time, which is the bug
an earlier task fixed. Do not reintroduce it"* — and importing the function from
there reintroduced it, starting a full warehouse build as a side effect of
asking for one function. It printed a stack trace and still worked, which is the
worst way for a mistake to behave.

### 2. The mart stops reshuffling on input it does not depend on

`build-marts.ts` ordered rows `ORDER BY s.common_name`, with no tiebreak. **89
common names are claimed by more than one species** (FR-D08), so those ties fell
to whatever DuckDB happened to do — and adding 1,015 image rows was enough to
reorder them.

That moved "Jack Dempsey" onto the other of its two rows and failed a market
calibration test for a reason that had nothing to do with images. Now
`ORDER BY s.common_name, s.species_id`.

### 3. One duplicate that was splitting real evidence

The reshuffle exposed a defect rather than causing one. `sp_jack_dempsey`
(*Rocio octofasciata*) and `sp_rocio_octofasciatum` (*Rocio octofasciatum*) are
the same fish under two spellings — *Rocio* is feminine, so the accepted
combination is *octofasciata* — and the market evidence was **split across
both**:

```
sp_jack_dempsey           13 listings,  3 stores
sp_rocio_octofasciatum    10 listings,  5 stores
merged                    23 listings,  7 stores
```

Scarcity is rated on witness count, so the Jack Dempsey read as **scarcer than
it is, on both rows**. Folded through `SPECIES_SYNONYMS`, the same mechanism and
the same shape as the existing *aequifasciata → aequifasciatus* entry.

**The failing test was right and the data was wrong.** It failed before this
change too — it passed only because the unstable sort happened to land on the
row with five stores.

## Scope

**In:** the four items above, and the regenerated marts.

**Out:**

- **The other 88 duplicate common names.** FR-D08 already owns this and says
  it plainly: "no name claimed by more than one species". Folding 88 pairs is a
  research task per pair — each needs a cited source saying two rows are one
  animal — and doing it under a portrait fix would be exactly the drive-by
  taxonomy this repo's citation rule exists to prevent. Filed as **BUG-21**.
- **A guard that the mart matches the files.** Worth having, and it belongs
  with FR-D09's drift guard rather than here.

## Acceptance criteria

1. Portrait coverage the app can **draw** — a mart row and a file — is over
   90% of the catalog, measured from `catalog.json` and the two portrait
   directories rather than from files alone.
2. `npm run reimage` rebuilds `dim_image` from `images.jsonl` with no network
   and no `listings.jsonl`, and importing its shared SQL starts no warehouse
   build.
3. Two consecutive `npm run marts` runs over unchanged input produce
   byte-identical `catalog.json`.
4. "Jack Dempsey" resolves to one species, carrying the merged 23 listings
   across 7 stores.

## What I would do differently

The measurement that would have caught this is one line, and it is now
criterion 1: **count what the app can draw, not what the ETL produced.** Every
number I reported for spec 058 and 062 was true of the artifact I had just
built and false of the app, because I never crossed the two.

## Requirements touched

- **FR-R11** — licensed portrait sourcing, bundled and precached. Its figure
  was wrong and is corrected.
- **FR-D08** — distinctive common names. One pair folded; 88 remain (BUG-21).
- **P6, never invent a number** — this is the failure mode one step earlier:
  not inventing a number, but measuring a real one that answered a different
  question.
