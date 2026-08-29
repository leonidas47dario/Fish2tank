# Local-shelf scarcity (spec 004) - implementation record

**Status:** complete and live. Index rebuilt with all 10 vendors.
**Date:** 2026-08-29

This replaces the original TDD plan. That plan was written against an index of
299 species on a branch nine commits behind `uat`; rebasing invalidated every
expected value in it, and the store reclassification below changed the design.
What follows is what was actually built and what is left.

---

## What shipped

**`src/data/store-channels.ts`** - one vendor-to-channel map, imported by the
app and covered by a test that fails the build if a store in `STORES` or in
the shipped index is unclassified. Community: Imperial Tropicals, AquaHuna,
Aquarium Co-Op, Nu Aqua. Specialist: Predatory Fins, Aquatic Arts, Global
Exoticquatics, J4 Flowerhorns, Flip Aquatics, LiveAquaria.

**`src/engine/rarity/market-scarcity.ts`** - `market-scarcity-v1.0.0`. Four
signals become two. `stockPressure` and `priceLevel` deleted; `storeBreadth`
rebuilt over witnesses only; `listingDepth` demoted to a negative nudge capped
at 12. One refusal rule: no witness carries it, no rating. `minimumWitnesses:
2`, because breadth is a comparison and one store cannot make one.

**`src/data/market.ts`** - derives `STORE_RESOLVE_RATES` from the index itself
(published listings over livestock listings), exposes `COMMUNITY_WITNESSES`
and `WITNESS_STORES`, and rewires `scarcityFor`.

**`etl/run.ts`** - two-pass matching. See below; this is the unblocker.

**`src/ui/components/MarketPanel.tsx`** - renamed to "Local-shelf scarcity",
signed component values, and copy naming the witness stores.

Tests: 437 passing, `tsc` clean. 37 engine tests, 5 channel tests, 9 data and
calibration tests.

## The two findings that changed the design

**Aquatic Arts is a specialist.** Ryan's call - "not a local fish store, more
in line with Predatory Fins" - and the catalogue shape agrees. Share of a
store's species that no other tracked store carries: Predatory Fins 79.2%,
Aquatic Arts 70.9%, Imperial Tropicals 45.6%, J4 42.3%. Reclassifying it left
exactly one qualifying witness, which is why the feature is dormant rather
than merely coarse.

**The catalog is 47 species.** Everything else the app knows was minted from
binomials vendors wrote in their own titles, so a shop listing "Black Ruby
Barb - L" could only ever match those 47. Nu Aqua - the one shop Ryan can walk
into, and the only true local-shelf witness in the list - had 1,222 livestock
listings and resolved 39. Two-pass matching (mint from the vendors who name
species, then re-read every store against that vocabulary) fixes it, measured
live:

| Store | Pass 1 | Pass 2 |
|---|---:|---:|
| Nu Aqua | 3.2% | **23.1%** |
| AquaHuna | 5.1% | 28.8% |
| Imperial Tropicals | 31.1% | 38.7% |
| Global Exoticquatics | 4.8% | 20.8% |
| J4 Flowerhorns | 20.7% | 32.2% |
| Aquarium Co-Op | 0.3% | 7.7% |
| LiveAquaria | 63.7% | 66.7% |

Aquarium Co-Op stays low for a reason no matcher can fix: its `products.json`
publishes 319 items of plants, food, apparel and filter parts, and no
livestock category at all. It cannot be a witness. `isLivestock` is separately
too permissive - it admits lanyards and keychains - but tightening it takes
Co-Op toward zero, not toward useful.

## Live result

`npm run reindex` now publishes an index covering **10 of 10 vendors**, 19,450
listings, 1,074 species. Nu Aqua is in it for the first time.

```
witnesses: imperial-tropicals 31.0%, aquahuna 28.6%, nu-aqua 24.1%   N=3

species 1074, rated 372
   widely-available      44   4.1%
   available             90   8.4%
   uncommon              37   3.4%
   scarce               201  18.7%
   rarely-listed          0   0.0%
   not-rated            702  65.4%
```

Spot-checked against fish anyone in the hobby can place:

| Fish | Band | Witnesses carrying |
|---|---|---|
| Neon Tetra | Widely available | all three |
| Cardinal Tetra | Widely available | all three |
| Bristlenose Pleco | Widely available | all three |
| Harlequin Rasbora | Widely available | all three |
| Electric Blue Acara | Widely available | all three |
| Oscar | Available | Imperial Tropicals, Nu Aqua |
| Jack Dempsey | Available | Imperial Tropicals, AquaHuna |
| Fancy Guppy | Available | Imperial Tropicals, Nu Aqua |
| Betta | Uncommon | Imperial Tropicals only |

Four of five bands populated, largest holds 54% of the rated set. Nothing
reads "rarely listed" - that needs five witnesses and there are three, which
is the ceiling rule doing its job rather than a gap.

**Betta at "uncommon" is the one visibly soft call**, and it is a matching
gap, not a rating bug: Nu Aqua stocks bettas but lists them as "Halfmoon Betta
- Male" and "Betta Crowntail Male", which the conservative single-word rule in
`etl/normalize/species.ts` will not match to the catalog name "Betta". That
rule exists to stop "Bass" swallowing "Peacock Bass" and should not be
loosened casually.

## How the blocker was cleared

Three vendors - Predatory Fins, Aquatic Arts, Flip Aquatics - return HTTP 503
from this machine. The body is a Palo Alto / Menlo Security interstitial
(`paloCategory = "society"`), so it is DRW's corporate egress filter, not the
vendors. It is not transient and was not routed around.

`npm run etl` therefore cannot complete, and `--allow-partial` correctly
refuses to reprice the catalog against seven stores. But the *warehouse*
already holds all three vendors' listings, and the two stores the warehouse
never saw (Nu Aqua, LiveAquaria) fetch fine. So `etl/rebuild-index.ts` gained
the ability to fold a raw snapshot in for any declared vendor absent from the
warehouse. Warehouse supplies the blocked three; snapshots supply the other
two; no network needed for the blocked hosts.

A full `npm run refresh` from an unfiltered network still reproduces this and
would additionally discover the 4,920 listings whose binomials are not yet in
`dim_species`.

## Still open

- **`isLivestock` is a denylist that defaults to true**, so unknown product
  types pass. It is why Aquarium Co-Op contributed 375 "livestock" listings
  that were mostly hardware. Worth its own change.
- **A fourth witness** would take sole-source to "rarely listed". Nu Aqua is
  in; LiveAquaria is excluded as marine. Petco and PetSmart remain the ones
  Ryan actually wants and neither is readable.
- **The Discovery Tier** (`discovery-tier-v0.2.0`) scores market scarcity for
  up to 15 points. While scarcity is unavailable that component is 0 for every
  specimen, which is honest but does lower discovery totals.
