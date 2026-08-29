# 004 - Local-shelf scarcity

**Status:** implemented, dormant on the shipped index (see docs/plans/004-local-shelf-scarcity.md)
**Date:** 2026-08-29
**Touches:** FR-P05 (online availability never increases collecting rarity), FR-R07 (no objective rarity claim below a sample threshold), FR-P06 (automated pricing retains source and confidence).
**Introduces:** store `channel` tiering, and the *witness gate* - a store's silence only counts as evidence when that store demonstrably resolves its own catalog.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "I want you to review the scacity rating algorithm now that we have more
> data, and improve it so it's accurately dipicts weather this is a rare fish
> to find. Note that big online stores like predator fin's data shouldn't be
> considered as the sample, since they are not local fish stores."

Three follow-up decisions, given directly:

- The badge answers **"would I see this on a local shelf"**, not "is this an
  unusual animal". A fish one click away at Predatory Fins is still rare,
  because you cannot walk out with it.
- **Breadth is the metric.** "If a fish is only avail in one store ever, that's
  actually a great easily quantifiable metric. In contrast, if it's avail in
  most stores, it's common."
- Scope is **both phases, sequenced**: correct the formula now, fix the sample
  after.

Noted for the backlog, not this spec: PetSmart and Petco are the witnesses
Ryan actually wants. Neither is readable (not Shopify, no product feed, blocked
at the network edge). LiveAquaria is already in `STORES` as the honest
substitute for a big-box baseline.

## The problem, stated accurately

The shipped index covers 299 species across 8 vendors. Scoring all of them
with the current formula:

| Band | Species | Share |
|---|---:|---:|
| Widely available | 0 | 0.0% |
| Available | 9 | 3.0% |
| Uncommon | 25 | 8.4% |
| Scarce | 102 | 34.1% |
| Rarely listed | 163 | 54.5% |

Betta scores 37. Fancy Guppy 42. Bristlenose Pleco 35. The single most
available fish in the catalog is Jack Dempsey at 27, and **nothing** reaches
"widely available". A rating where 89% of the catalog is scarce or rarer
carries no information.

Three of the four signals are measuring something other than what they claim.

### 1. Store breadth measures title conventions, not stocking

Resolution rate per store - matched listings over livestock listings:

| Store | Livestock | Matched | Resolve | Species |
|---|---:|---:|---:|---:|
| Predatory Fins | 2,429 | 1,811 | **74.6%** | 275 |
| Aquatic Arts | 5,127 | 902 | 17.6% | 45 |
| Imperial Tropicals | 4,133 | 497 | 12.0% | 73 |
| J4 Flowerhorns | 634 | 33 | 5.2% | 22 |
| Global Exoticquatics | 331 | 13 | 3.9% | 7 |
| AquaHuna | 704 | 12 | 1.7% | 7 |
| Flip Aquatics | 1,701 | 7 | 0.4% | 2 |
| Aquarium Co-Op | 375 | 1 | **0.3%** | 1 |

Predatory Fins writes binomials in its product titles; `etl/normalize/species.ts`
leans on parenthesised binomials, so PF resolves three-quarters of its catalog
and everyone else resolves a rounding error. Aquarium Co-Op moved 375 livestock
listings and matched **one species**.

The consequence: 275 of 299 species come from Predatory Fins, **198 of them
sole-source**, and the top 25 "rarest" fish are *all* PF exclusives. The
8-store denominator is a fiction, and the rating is a Predatory Fins catalog
dump wearing a scarcity label.

### 2. Stock pressure is a Shopify artifact

84% of the dataset is sold-out back catalogue that stores never unpublish, and
180 of 299 species have zero units in stock. "Sold out" is the base rate, so
the signal hands 25 points to nearly everyone for a platform habit rather than
for demand.

### 3. Depth saturation is mis-scaled

`depthSaturation` is 20 listings. The median species has 4-5, and half have 5
or fewer, so the typical species banks ~23 of 30 depth points for being
typical.

### 4. The scale is absolute, never checked against the distribution

Every threshold in `DEFAULT_SCARCITY_CONFIG` is a hardcoded constant. None was
calibrated against observed data.

---

## Design

### Store tiering

`StoreConfig` gains a required `channel` field.

- **`community`** - generalist shops whose catalog approximates a normal local
  shelf. **These are the sample.** Imperial Tropicals, AquaHuna, Aquarium
  Co-Op, Nu Aqua.
- **`specialist`** - exotics importers, aggregators and single-niche
  boutiques. Predatory Fins, Aquatic Arts, Global Exoticquatics, J4
  Flowerhorns, Flip Aquatics, LiveAquaria.
  They contribute price data and proof that the animal exists in trade. They
  are **never** in the breadth numerator or denominator.

**Aquatic Arts is `specialist`** on Ryan's call - "not a local fish store,
more in line with Predatory Fins" - and the catalog shape agrees. Share of a
store's species that no other tracked store carries:

| Store | Species | Sole-source | Share |
|---|---:|---:|---:|
| Predatory Fins | 534 | 423 | 79.2% |
| **Aquatic Arts** | **467** | **331** | **70.9%** |
| Imperial Tropicals | 193 | 88 | 45.6% |
| J4 Flowerhorns | 104 | 44 | 42.3% |

A store where seven of every ten species are carried by nobody else is
behaving like an aggregator of unusual stock, not like a shelf. Imperial
Tropicals, at 45.6%, overlaps the rest of the market roughly twice as much.

Two more assignments worth stating explicitly, because they are judgement calls:

- **Flip Aquatics is `specialist`.** A shrimp and invert boutique, not a
  general shop. Its not carrying a cichlid is not evidence about cichlids.
- **LiveAquaria is `specialist`**, reversing an earlier draft of this spec. It
  is Petco's aquatics brand, and a big-box chain stocking a fish *would* be the
  strongest evidence available that the fish is not rare - which is exactly why
  it was tempting. It is out because it is overwhelmingly **marine**: 7,714
  livestock listings dominated by coral and reef fish. A marine store's silence
  about a freshwater fish is not evidence of anything, and counting it as a
  witness would push every freshwater species toward "rare" on a technicality.
  Revisit if the index ever carries water type per species.

`waterType` already exists on `StoreConfig` and is unchanged; `channel`
answers a different question (what kind of buyer the store serves) and the two
are deliberately independent.

Note the `channel` field was **not** added to `StoreConfig` in the end. The map
lives in `src/data/store-channels.ts` so the app can classify the already-built
index without an ETL re-run, with a test that fails the build on any
unclassified vendor.

### The witness gate

**A store's silence is only evidence if that store can speak.**

A community store enters the breadth denominator only when its resolution rate
- matched listings over livestock listings, computed by the ETL and written
into the index - clears `witnessMinResolveRate`. Below that line the store is
not a witness: it contributes listings when it *does* match, but its absence
is discarded rather than counted against the species.

This is the mechanism that makes absence usable at all, and it replaces the
blanket "absence is not evidence" disclaimer with something quantified. It is
also self-repairing: as Phase B raises resolution rates, stores rejoin the
denominator automatically and the scale gains rungs. One number governs how
much the app is willing to claim.

Initial threshold: **10%**, plus `minimumWitnesses: 2` - breadth is a
comparison, and one store cannot make one. With a single witness every species
it carries would score 0 and every species it does not would be unrated, so the
badge would have exactly one possible value while implying it had consulted a
market.

Against a two-pass ETL run of the seven stores that answered, that admits
Imperial Tropicals (38.7%), AquaHuna (28.8%) and **Nu Aqua (23.1%)**. Against
the *currently shipped* index it admits only Imperial Tropicals, so the rating
refuses outright.

### The formula

Four signals become two.

**Deleted - `priceLevel`.** Price is a consequence of rarity, not evidence of
it, and it already has its own panel. Keeping it double-counts and lets a big
adult oscar read as rare because it is expensive.

**Deleted - `stockPressure`.** See problem 2. It measures Shopify, not scarcity.

**Promoted - `storeBreadth`.** Now the base of the score.

**Demoted - `listingDepth`.** No longer an independent additive component; a
small within-rung nudge, so a fish one shop lists 40 times reads as more
findable than one it listed twice.

```
witnesses  = community stores whose resolveRate >= witnessMinResolveRate
carrying   = witnesses that carry this species
listings   = listings for this species across witnesses only

base   = 100 * (1 - carrying / witnesses.length)
nudge  = min(depthNudgeMax, depthNudgeScale * ln(1 + listings))
score  = clamp(base - nudge, 0, 100)
```

Config: `depthNudgeMax: 12`, `depthNudgeScale: 4`, `witnessMinResolveRate: 0.10`.
Band cut points are unchanged except `rarely-listed`, which moves from 80 to
75 for the reason given below. `formulaVersion` becomes
`market-scarcity-v1.0.0` - a breaking change, and every stored rating carries
the version that produced it.

### When the rating refuses to appear

One rule: **`computeMarketScarcity` refuses whenever `carrying === 0`.**

If no witness carries the species, every scrap of evidence we hold comes from
a store that cannot resolve its own catalog, and "rare" is indistinguishable
from "the matcher missed it". That single condition subsumes all three cases
worth refusing - the species has no index entry, no community store qualifies
as a witness, or the only stores carrying it are specialists like Predatory
Fins. Each still gets its own reason string, since the UI renders them and
they are diagnostically different, but the arithmetic is one branch.

**The scale's ceiling therefore rises with the witness count, which is the
point.** A species carried by exactly one witness - Ryan's own rarity test -
scores `100 × (1 − 1/N)`:

| Witnesses `N` | Base | Score after depth nudge | Band |
|---:|---:|---:|---|
| 2 (today) | 50 | 46 | Uncommon |
| 3 | 67 | 63 | Scarce |
| 4 | 75 | 71 | Scarce |
| 5 | 80 | 76 | **Rarely listed** |
| 6 | 83 | 79 | **Rarely listed** |

The depth nudge is why the `rarely-listed` band cut moves from **80 to 75**.
At 80, a sole-source fish never reaches the top band even at six witnesses -
the nudge subtracts it back into "scarce" - which would quietly defeat the
whole metric. The cut changes nothing about today's index, where the highest
achievable score is 47.

With two witnesses the app *cannot* call anything rarely listed, and it should
not be able to: on evidence from two shops, "rare" is not a claim you can
support. At five or six witnesses, sole-source lands in the top band exactly
as asked. The formula earns the right to its strongest word rather than
assuming it.

### What this achieves, verified

Built in memory from the seven store snapshots that answered, using the
shipped engine:

```
witnesses: imperial-tropicals (38.7%), aquahuna (28.8%), nu-aqua (23.1%)   N=3

species 1464
   widely-available      55   3.8%
   available             78   5.3%
   uncommon              37   2.5%
   scarce               157  10.7%
   rarely-listed          0   0.0%
   not-rated           1137  77.7%
```

Four bands populated and the largest holds 48% of the rated set, so the scale
discriminates. Oscar reads "available", carried by Imperial Tropicals and Nu
Aqua. A sole-witness fish scores 63 and reads "scarce" - Ryan's metric, one
rung short of its ceiling until a fourth witness exists.

**On the currently shipped index it rates nothing.** With Aquatic Arts
reclassified there is one qualifying witness, and `minimumWitnesses: 2` refuses
rather than emitting a badge with a single possible value. The feature is
dormant until the ETL republishes, which is blocked only by three stores
returning 503. See docs/plans/004-local-shelf-scarcity.md.

---

## Phase B - fix the sample

Phase A is inert without this. In order:

1. ~~Diagnose the resolution gap.~~ **Done, and the hypothesis was wrong.**
   `80769ba` on uat (read the binomial the vendor already wrote) fixed most of
   it: Aquatic Arts went 17.6% -> 73.4%, Imperial Tropicals 12.0% -> 21.5%,
   Predatory Fins 74.6% -> 90.2%, and the index went from 299 species to 1,072.

   Aquarium Co-Op stayed at 0.3%, and reading its 375 rows out of
   `warehouse/fact/fact_listing.parquet` shows why. It is **not** a matcher
   problem and not a common-name problem: the sample is barely livestock.
   Titles include "Aquarium Co-Op Lanyard", "Murphy Mbu Puffer Keychain",
   "Filter Optimizing Pad", "Aquarium Plant Weights", "Broken Seal Easy Green"
   and a long tail of Aponogeton and Anubias. Zero of the 375 carry a
   parenthesised binomial because almost none of them are fish. `isLivestock`
   in `etl/normalize/listing.ts` is admitting hardware and plants, and 375
   total products is itself suspiciously low for that vendor.

2. **Fix `isLivestock`, not the matcher, for Aquarium Co-Op** - and confirm
   whether its fetch is truncated. Widening common-name matching is not the
   fix here and would not help.
3. **Get all 10 declared stores into the index.** Nu Aqua and LiveAquaria are
   in `STORES` but absent from the shipped index, because an offline run with
   no snapshot for them published anyway. The `--allow-partial` guard on
   `etl/run.ts` now prevents a recurrence; these two still need a real fetch.
   Nu Aqua matters most - it is the one vendor Ryan can physically walk into.
4. **Re-run and confirm** resolution rates cross the witness threshold, then
   check the band distribution moves toward a usable spread.

Phase B is scoped and planned separately. This spec covers Phase A, and
records Phase B so the sequencing is not lost.

---

## Testing

Phase A is a pure function over a fixed index, so it tests directly.

- **Calibration is a test, not a vibe.** A fixture asserting that Betta,
  Fancy Guppy and Bristlenose Pleco land in `widely-available`, and that no
  more than a stated share of the catalog occupies the bottom band. This is
  the check that would have caught the current bug on day one, and its absence
  is why the bug shipped.
- **Witness gate:** a species carried only by a below-threshold store is
  refused; raising that store's resolve rate past the threshold makes the same
  species rateable, with no other input changed.
- **Specialist-only species** returns `available: false`, never
  `rarely-listed`. Directly encodes the ask about Predatory Fins.
- **Specialists never move breadth:** adding a PF listing to any species leaves
  its score unchanged.
- **Ceiling scales with witnesses:** a sole-witness species reads `uncommon` at
  `N=2` and `rarely-listed` at `N=5`. This is the test that stops someone
  "fixing" the low coverage by loosening the threshold - doing so has to move
  the bands, visibly.
- **Deletions stay deleted:** changing `inStock` or median price on a fixture
  leaves the score unchanged.
- **Distribution guard** over the real shipped index, so a future ETL run that
  collapses the bands fails CI rather than shipping.

## Files

- `src/data/store-channels.ts` **(new)** - the vendor-to-channel map, imported
  by both the app and the ETL so the classification cannot drift.
- `src/engine/rarity/market-scarcity.ts` - the formula.
- `src/data/market.ts` - derives each store's resolve rate from the index and
  hands the qualifying community stores to the engine, replacing the raw
  `trackedStores` count.
- `src/ui/components/MarketPanel.tsx` - component labels change; "usually sold
  out" and "priced above typical" disappear.

**Phase A needs no ETL change and no re-run.** Resolve rate is published
listings over livestock listings, and both numbers are already in the shipped
`market-index.json`. Emitting the ETL-side *true* match rate - which is
slightly higher, since the runtime figure excludes species dropped for thin
sampling - belongs to Phase B, alongside the store `channel` field on
`StoreConfig`.

`src/ui/components/Badges.tsx` does **not** change: `SCARCITY_LABELS` and
`MarketScarcityBand` are untouched.

Implementation plan: [docs/plans/004-local-shelf-scarcity.md](../plans/004-local-shelf-scarcity.md).
