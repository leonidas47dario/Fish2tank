# 003 - Local-shelf scarcity

**Status:** proposed
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
  shelf. **These are the sample.** Imperial Tropicals, Aquatic Arts, AquaHuna,
  Aquarium Co-Op, Nu Aqua, LiveAquaria.
- **`specialist`** - exotics importers and single-species boutiques. Predatory
  Fins, Global Exoticquatics, J4 Flowerhorns, Flip Aquatics. They contribute
  price data and proof that the animal exists in trade. They are **never** in
  the breadth numerator or denominator.

Two assignments worth stating explicitly because they are judgement calls:

- **Flip Aquatics is `specialist`.** It is a shrimp and invert boutique, not a
  general shop. Its not carrying a cichlid is not evidence about cichlids.
- **LiveAquaria is `community`.** It is Petco's aquatics brand, and a big-box
  chain stocking a fish is the strongest available evidence that the fish is
  not rare. Its marine skew means it will rarely fire for freshwater species,
  which is correct rather than a defect.

`waterType` already exists on `StoreConfig` and is unchanged; `channel`
answers a different question (what kind of buyer the store serves) and the two
are deliberately independent.

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

Initial threshold: **10%**. Under today's index that admits Aquatic Arts
(17.6%) and Imperial Tropicals (12.0%) and nobody else.

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

### What Phase A alone achieves, stated honestly

Simulated over the shipped index at a 10% threshold, denominator of 2:

| Band | Species | Share of catalog |
|---|---:|---:|
| Widely available | 24 | 8.0% |
| Available | 7 | 2.3% |
| Uncommon | 63 | 21.1% |
| Scarce | 0 | 0.0% |
| Rarely listed | 0 | 0.0% |
| **Not enough data** | **205** | **68.6%** |

94 of 299 species rated, down from 299. Betta, Fancy Guppy, Bristlenose Pleco,
Oscar and Jack Dempsey all move from "scarce" to widely available - the
headline bug, fixed. The 205 refusals are overwhelmingly Predatory Fins
exclusives, which is the ask about PF enforced arithmetically rather than by
disclaimer.

**Phase A makes the badge honest, not smart.** It stops lying about common
fish, stops laundering the Predatory Fins catalog into a rarity scale, and
loses the ability to call anything rare until the sample can support it. That
is a two-thirds cut in coverage, taken deliberately. Phase B is what earns the
rating back, and it is the phase that turns those 205 refusals into real
rarity calls.

---

## Phase B - fix the sample

Phase A is inert without this. In order:

1. **Diagnose the resolution gap.** Fetch fresh snapshots for Aquarium Co-Op,
   Imperial Tropicals, Aquatic Arts and AquaHuna and measure *why* titles miss.
   The working hypothesis is common-name-only titles, but the repo currently
   holds raw snapshots for Global Exoticquatics and J4 Flowerhorns only, so
   this is unverified and must be measured before any matcher change.
2. **Widen matching for the community tier** against catalog common names and
   aliases, keeping the existing guard that makes single-word names match only
   when they are essentially the whole title. `etl/normalize/species.ts`
   documents why - "Bass" versus "Peacock Bass" - and that discipline holds.
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

Implementation plan: [docs/plans/003-local-shelf-scarcity.md](../plans/003-local-shelf-scarcity.md).
