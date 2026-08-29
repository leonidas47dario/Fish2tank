# Local-shelf scarcity (spec 004) - implementation record

**Status:** complete and live, on a branch merged up to `uat`.
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

`npm run reindex` publishes an index over **11 of 12 vendors** (Petco declared
but contributing nothing yet), 24,624 listings, 2,176 species.

```
witnesses: imperial-tropicals 36.3%/16.2%, aquahuna 30.1%/7.0%, nu-aqua 29.2%/9.9%
           (resolve / coverage)                                          N = 3

species 2176, rated 475
   widely-available      64  13.5% of rated
   available            118  24.8%
   scarce               293  61.7%
```

| Fish | Band | Witnesses carrying |
|---|---|---|
| Neon Tetra | Widely available | all three |
| Cardinal Tetra | Widely available | all three |
| Bristlenose Pleco | Widely available | all three |
| Fancy Guppy | Available | Imperial Tropicals, Nu Aqua |
| Oscar | Available | Imperial Tropicals, Nu Aqua |
| Jack Dempsey | Available | Imperial Tropicals, AquaHuna |
| Zebra Danio | Available | AquaHuna, Nu Aqua |
| Jaguar Cichlid | Scarce | Imperial Tropicals |
| **Betta** | **Scarce** | Imperial Tropicals |

`uncommon` and `rarely-listed` are empty, and that is arithmetic rather than a
gap: breadth is `100 * (1 - carrying/N)`, so three witnesses give exactly three
rateable values (0, 33, 67) which land in three bands. Four witnesses would
give 0/25/50/75 and five would give one per band. A test pins this mapping, so
growing the sample fails loudly and the expectations get looked at.

**Betta at "scarce" is wrong, and it is a matching gap rather than a rating
bug.** Nu Aqua stocks bettas and lists them as "Halfmoon Betta - Male" and
"Betta Crowntail Male"; the single-word rule in `etl/normalize/species.ts` will
not match those to the catalog name "Betta". That rule stops "Bass" swallowing
"Peacock Bass" and should not be loosened casually - the fix is a size/sex
suffix stripper, not a looser matcher.

## How the blocker was cleared

Three vendors - Predatory Fins, Aquatic Arts, Flip Aquatics - return HTTP 503
from this machine, and the body is a Palo Alto / Menlo Security interstitial
(`paloCategory = "society"`). That is DRW's corporate egress filter, not the
vendors. It was not routed around.

`npm run etl` therefore cannot complete here. But the warehouse already holds
all three vendors' listings, so `etl/rebuild-index.ts` does the work instead,
with two changes: it now matches against the full catalog mart rather than the
47 curated species, and it can fold in a raw snapshot for any declared vendor
the warehouse never held. That is what put Nu Aqua in the index.

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
