# 005 - The catch journey, and putting fish in tanks

**Status:** implemented. Changes A-D in PR #21; E and F in the follow-up PR.
**Date:** 2026-08-29
**Touches:** FR-I01 (Unknown is a valid identity state), FR-I04 (no confidence percentages), FR-R05 (the breakdown is shown), FR-R07 (no local rarity claim), FR-T01 (one record follows the fish), FR-T02 (an opening-balance holding has no specimen), FR-P05 (online availability and collecting rarity).
**Introduces:** Discovery Tier v0.3.0 (market-only), mandatory identification, multi-holding backfill, and a taxonomic gate on species minting.

---

## What was asked

Verbatim, across three messages, so the interpretation stays auditable.

On the catch journey:

> "1. When idenfied a new speciies, it should also reveal the whole catelog
> profiee (pic 1) rather than just the name. In the full catch, identity should
> have 2 sections: 1. label (required) 2. nick name (optional) 3. size and price
> should only have a asking price. Discovery section can not be deleted, the
> rating score is solely relying on market reference for the tagging. Your tanks
> analysis section should be under If it comes home. And right now it doesn't
> have a collapse feature when expanded. Ideally it opens a new tab which
> dedicated analysis rather than on the same page. we will keep the current
> functionality but it's something that I'd like to build out more in the
> future."

On the wish list:

> "actually we can keep the wish list feature, it's more functional now. I just
> don't want the scoring system"

On backfill:

> "Currently there is no functionality to backfill a fish into my tank. e.g:
> when I go to congo puffer and clicked on +Add your photo, it does created a
> record for your fish. but then when I go to the record, there is no option to
> add the fish to an existing tank. it seems like the only way to backfill is to
> go through the catch journey. Also, the backfill seemed to only allowing
> adding a single fish, but the reality is that I have multiple of the same
> fish. so it should give me the ability to add multiple fishes rather than just
> 1 photo and infering to be 1 fish."

And clarifying the last point:

> "should have mutliple records, becasue I could have 1 fish in 1 tank and 1
> fish in the other. I think right now, the assumption was that I had 1 fish
> profile in one tank, but rality is 1 fish in one tank, another in a different
> tank. this isn't currently supported."

### Decisions given directly

Asked and answered before any code was written:

- **Label means the catalog species**, and it is **hard-blocking**: "all records
  must be identified."
- **Identification is required before leaving the identify flow.** The "Not yet"
  escape is removed.
- **Discovery score is the market scarcity score**, fed into the existing
  80/60/40/20 tier cuts. Species with no shelf evidence are **not rated at all**
  rather than scored zero.
- **The Dream List stays a working feature** and stops awarding points.
- **Size and price loses member price**, keeps size.
- **Your tanks placement, the collapse, and the dedicated analysis tab are out
  of scope** - the Drawer rebuild already addressed the placement.
- **Backfill is folded into this branch** rather than sequenced after it.
- **Both phantom species are gated and remapped**, not just gated.

### Raised during the build, deferred to spec 006

The tank moves holdings rather than fish: *"I think profile and actual fish
were treated as the same thing, while it shouldn't."* Correct, and confirmed -
`TankDetail` binds its move control to a holding, so moving "Rocket gar ×3"
moves all three, and a holding of three has at most one photo between them.

The unit model is its own spec by decision. Units are to be created **on
demand** - a holding keeps its count, and any individual you want to
photograph, name or move alone is split out at that moment - so the Breeder
Tote's 50 feeder guppies never expand into 50 records unless asked. Change E
below is the holding-level backfill that precedes it, kept because it is what
makes a fish reachable at all.

### Deliberately not in scope

The dedicated tank-analysis tab, and any collapse behaviour on Your tanks.
Recorded here because it was raised and explicitly deferred: *"we will keep the
current functionality but it's something that I'd like to build out more in the
future."*

## The baseline this is written against

Worth stating, because the first pass of this design was written against
`feat/local-shelf-scarcity` and was wrong in one substantive way.

`origin/uat` at `b020e8a` carries the Drawer rebuild (#17) and tanks CRUD.
`FishCard.tsx` no longer exists; `Plate.tsx` and `Tile.tsx` replaced it.
`SpecimenDetail.tsx` is 824 lines, not 412. `TankDetail.tsx` is new. Every
design below is against `b020e8a`.

## Change A - the reveal shows the profile, not just the name

`RevealCeremony` renders a common name and a scientific name and nothing else
(`RevealCeremony.tsx:163-166`). The ask is the whole catalog profile.

**The obvious answer is wrong and must not be built.** The collectible card was
deleted on purpose in the Drawer rebuild, and `Tile.tsx` records why: the card's
structure was three numbers - price, adult size, minimum tank - and *"the
catalog has BOTH adult size and minimum tank for 92 of 2,178 species. Nineteen
tiles in twenty drew a card format whose whole structure was three numbers, and
had at most one of them."* Reinstating that format for the reveal would rebuild
a thing this repo already measured and rejected.

So the reveal composes what the rebuild kept:

- `Plate` for the art, which already handles the three states that matter here,
  including *no portrait exists* - true for 1,167 of 2,178 species, so the
  common case is a reveal with no photograph.
- The conditional fact line `Tile` uses: each of adult size, minimum tank,
  temperament, temperature and water zone drawn only when it exists, nothing
  inferred, no placeholder for a fact that will never arrive.

The four beats are unchanged: card rise, bubbles, **profile**, tier stamp. The
three non-negotiables in the component docstring hold - skippable at any frame,
reduced motion means no motion and no timers, and the snapshot is already
written before this renders.

`RevealCeremony` currently takes `commonName` and `scientificName` as loose
strings. It takes a `CatalogCard` instead, which `IdentifyFlow` and
`SpeciesDetail` both already know how to assemble. That assembly is lifted into
a `useCatalogCard(speciesId)` hook rather than copied, because
`SpeciesDetail.tsx` builds it inline from six Dexie tables and a second inline
copy would drift - the same failure `Plate.tsx` describes having already had
with `useCardArt`.

## Change B - Identity is a required label and an optional nickname

Today the Identity panel forks on `identityStatus !== 'user-confirmed'`
(`SpecimenDetail.tsx:263`): unconfirmed shows a catalog search, confirmed
replaces it with a sentence. Two consequences, both bad. A misidentification
becomes uncorrectable from the panel that made it, and nickname is the only
field that is always present, which is backwards - it is the optional one.

It becomes two fields, always both present:

| Field | Required | Behaviour |
|---|---|---|
| Label | yes | The catalog species. Shows the current species with a way to change it, or the search when unset. |
| Nickname | no | Unchanged, marked optional. |

Nickname is currently rendered **twice** - here and again in `EditCatchForm`'s
"Correct the record" panel. Identity keeps it; the duplicate goes, so there is
one place a nickname is edited.

### What hard-blocking means

The decision was "all records must be identified." Enforced in two places:

**In the record.** Until Label is set, Identity is the only live panel. Size and
price, Market reference, Your tanks, Discovery, Story, Correct the record and If
it comes home are all sealed behind a single stated reason. Nothing is deleted
and no media is at risk - the record is intact, it just does not proceed.

**In the identify flow.** The "Not yet" button (`IdentifyFlow.tsx:168`) is
removed.

### The dead end this creates, and the one escape

Removing "Not yet" traps anyone whose fish is not in the catalog. The flow
already anticipates this and currently resolves it by leaving the record
Unknown: *"Nothing in the catalog matches that. Leave it Unknown and the record
still keeps your photo and the store label."* That resolution is now forbidden.

**Decision, made here rather than deferred, and the one point in this spec most
likely to need overriding:** a single escape survives, for genuinely
uncatalogued fish only. It demands the store label be typed, writes it to
`rawLabel`, and records `identityStatus: 'provisional'` - a state the domain
already has and barely uses. It is not a skip. "Not yet" costs a tap and yields
`unknown`; this costs a sentence and yields a weaker identification that the
record then displays as weaker. Without it the app can strand a real catch on a
screen with no exit.

Two things that follow, stated plainly rather than discovered later:

- **`unknown` records will still exist.** The back button, closing the tab, and
  every specimen already on the device all produce them, and a single-page app
  cannot prevent that. The record-level block, not the flow change, is what
  actually carries the guarantee.
- **This narrows FR-I01**, which says Unknown is a valid state to keep forever.
  That requirement is now superseded by direct instruction. Recorded here so the
  contradiction is deliberate and visible rather than an unexplained drift.

## Change C - asking price only

Member price comes out of `PriceForm` (`SpecimenDetail.tsx:742-802`): the state,
the input, and the argument to `recordPrice`. Size stays, because it feeds the
market size-band comparison and the tank screening.

`recordPrice` keeps its `memberPrice` parameter and the readout keeps its
conditional Member row (`SpecimenDetail.tsx:326-327`), so a price captured
before this change still displays what it captured. `MarketPanel` switches from
`price?.memberPrice ?? price?.askingPrice` to `price?.askingPrice`
(`SpecimenDetail.tsx:359`).

## Change D - Discovery Tier v0.3.0, market reference only

### The formula

Score is the market scarcity score, 0-100, passed straight through. Tier cuts
stay at 80/60/40/20/0. `firstConfirmedSpecies`, `dreamListHit`,
`personalEncounterScarcity` and `exceptionalSpecimen` stop scoring.

This completes a direction v0.2.0 started. That version's docstring already
records the deviation from FR-P05 and its cost: *"the score now mixes 'how novel
is this to me' with 'how hard is this to mail-order', and those can disagree
sharply."* v0.3.0 resolves the disagreement by keeping only the second.

### Historical snapshots are not rewritten

The four retired keys become optional on `RarityComponentBreakdown` and keep
their entries in `COMPONENT_LABELS`. v0.2.0 snapshots still render all five
components; v0.3.0 snapshots carry only `marketScarcity`. The breakdown UI
already iterates `Object.keys(snapshot.components)`, so both render with no
branch. This is the guarantee the PRD attaches to the formula - *"tuning never
rewrites a historical reveal snapshot"* - and it is why the type loosens rather
than changes.

### No shelf evidence means no rating

Measured across the shipped index: **475 of 2,178 catalog species have a
scarcity rating available. 1,703 do not.** The refusal is not an edge case, it
is 78% of the catalog.

`scarcityFor` already returns a typed refusal with a reason and an explanation.
When it refuses, `revealSpecimen` writes no snapshot and the Discovery panel
shows that reason. Scoring those species zero would read as "widely available",
which is the opposite of what a refusal means - `market-scarcity.ts` says so
directly: *"Absence is not evidence of scarcity."*

`revealSpecimen` currently returns `RaritySnapshot | undefined` where `undefined`
means "already revealed". A refusal is a third outcome and must not be reported
as the second, so the return becomes a discriminated union. Per the logging
standard, it logs intent and outcome including the refusal reason.

### The resulting distribution

Across the 475 rateable species:

| Tier | Species | Share of rated |
|---|---:|---:|
| Legendary | 0 | 0.0% |
| Epic | 248 | 52.2% |
| Rare | 45 | 9.5% |
| Uncommon | 118 | 24.8% |
| Familiar | 64 | 13.5% |

Legendary is unreachable, and that is a property of the sample rather than a
defect. Three of five community stores clear the witness gate, and
`market-scarcity.ts:49-53` records that N witnesses produce exactly N possible
breadth values: at N=3 the maximum is 67, at N=4 it is 75, at N=5 it is 80. The
top tier unlocks when a fourth store clears the gate. Per that file's standing
instruction: *"Do not 'fix' it by loosening a gate; grow the sample."*

### The Dream List keeps working

`dreamListHit` stops scoring. Every other Dream List behaviour stays, including
the one that would otherwise break silently: `revealSpecimen` is also what marks
a dream item **fulfilled** (`repositories.ts:473-475`), inside the snapshot
transaction. With reveals now refused for 78% of species, fulfilment inside that
transaction would stop firing for most of the catalog. Fulfilment moves out of
the snapshot write and happens on identification, whether or not a snapshot
follows.

## Change E - backfill

The unit is the **holding**: one species, in one tank, with a count. Multiple
holdings per species is how "one in the 75, one in the 40" is recorded.

This is already how the importer works. `inventory-import.ts:118-138` writes one
holding and one residency per spreadsheet row, with
`kind: row.quantity > 1 ? 'group' : 'individual'`. Two Congo Puffer rows in two
tanks import correctly today. **Nothing in the model needs to change** -
`Holding.kind`, `openingQuantity`, signed `quantityDelta`, and the `acquired`
and `quantity-adjusted` life-event types all exist, and `deriveQuantity` already
sums them. Every gap below is UI.

### E1 - the record stops using status as a proxy for placement

`SpecimenDetail.tsx:427` gates the tank picker on `status !== 'resident'`. But
`ensureSpecimenForHolding` stamps `status: 'resident'` at creation
(`repositories.ts:576`), so a specimen minted by adding a photo can never show
the picker - which is exactly the reported bug. The proxy is replaced by the
real question: does this specimen have a holding with an open residency?

| Situation | Affordance |
|---|---|
| No holding | "Bring into" + quantity - mints holding, residency, `acquired` event |
| Holding, no open residency | "Place in" - opens a residency on the existing holding |
| Holding in a tank | Shows where, plus "Also add to another tank" - mints a second holding |

The third row is what makes one-in-each-tank recordable from the record.

### E2 - stocking a tank directly

An "Add a fish" control on the tank, backed by a new
`stockTank({ aquariumId, speciesId, quantity, on })` writing a holding, a
residency and an `acquired` event - the same shape the importer writes, so
backfilled and imported fish are indistinguishable afterwards.

It creates **no specimen**, deliberately. `Holding.specimenId` is optional by
design under FR-T02, and `ensureSpecimenForHolding` already exists to mint one
when a photo is added. Minting eagerly here would duplicate that path and
manufacture an encounter that never happened.

### E3 - quantity is asked for

`BringHome` calls `acquireSpecimen(specimenId, chosen.id)`
(`SpecimenDetail.tsx:483`) and takes the default of 1, dropping a parameter the
repository already accepts. It gains a quantity field, defaulted from
`encounter.quantitySeen` where that exists - the encounter already records how
many were seen, and re-asking a question the record has answered is a small
insult.

### E4 - counts can rise

Tanks offers "Record a loss" and nothing that adds. An "Add more" control writes
a positive `quantityDelta` through the existing `recordLifeEvent`.

### E5 - two things multiple holdings break

Both become wrong the moment E1 and E2 can create a second holding, so both are
fixed here rather than left as a trap:

- `targetSpecimenId` (`SpeciesDetail.tsx:142-151`) picks a holding with `.find()`.
  With two holdings of a species, a photo lands on whichever comes first. The
  target is chosen explicitly when there is more than one.
- "Your fish" on the species page lists specimens, so a holding without one is
  invisible. It lists holdings, with tank and count.

## Change F - two phantom species

`Red Wolf Fish ( Roofvissen fotografie ) 4"` is a real J4 Flowerhorns product
title. The ETL reads parenthesised text as a scientific name, which is a sound
heuristic - `Jaguar Cichlid (Parachromis managuensis)` works. Here the vendor
put a **photo credit** in the parens. "Roofvissen fotografie" is Dutch for
"predatory fish photography", and it passes every shape test for a binomial: two
words, capitalised genus, lowercase epithet, Latin alphabet.

So the matcher minted `sp_roofvissen_fotografie`, and the portrait backfill -
searching on the *common* name - attached a genuine red wolf fish photograph
from iNaturalist. A phantom species wearing correct art.

Scanning all 1,473 vendor-minted species finds exactly two bad entries. The
heuristic is sound; this is a narrow failure, not a systemic one.

| Species id | Scientific name | Listings | Stores | Rateable? |
|---|---|---:|---|---|
| `sp_roofvissen_fotografie` | Roofvissen fotografie | 1 | j4-flowerhorns | No - not a witness |
| `sp_fish_food` | Fish food | 20 | imperial-tropicals, aquarium-coop, liveaquaria | **Yes** |

`sp_fish_food` is the worse of the two. Its eight aliases are Hikari wafers and
CarniSticks - it is a species minted from fish food. Imperial Tropicals is one
of the three witness stores, so it *is* rateable, and under change D it scores
as `scarce` and would be awarded a Discovery tier of **epic**. The catalog
contains a browsable, collectible, epic-tier fish called Fish food.

Change D is why this is in scope rather than on the backlog: making the tier
depend solely on market evidence raises the cost of a phantom that has market
evidence.

Three parts:

1. **A taxonomic gate** in the minting step, rejecting a parenthesised candidate
   that carries non-taxonomic vocabulary or a capitalised epithet. Rejected
   candidates go to `unmatchedScientificNames`, which already exists for
   listings that resolve to nothing - the honest destination.
2. **A remap.** `sp_roofvissen_fotografie` merges into `sp_erythrinus_erythrinus`,
   which is already in the catalog as "Rainbow Wolf Fish" - *Erythrinus
   erythrinus* goes by both names, so the phantom is a straight duplicate and
   its listing joins the real fish. `sp_fish_food` is dropped; it is not an
   animal.
3. **A migration**, because a specimen on the device already points at
   `sp_roofvissen_fotografie`. Retiring the id without remapping stored
   `speciesId` values on `specimens`, `holdings`, `raritySnapshots`,
   `priceObservations` and `cardPrefs` would strand that record as Unknown.

Marts rebuild offline from the warehouse via `npm run marts`, so the Predatory
Fins edge block does not apply.

`npm run reindex` was deliberately NOT run, and must not be until `etl/raw` is
repopulated. It rebuilds the market index from the warehouse alone, and the
warehouse never held Nu Aqua or LiveAquaria - they came from raw snapshots that
are not committed. Nu Aqua **is one of the three witness stores**, so
reindexing today would cut the gate from three witnesses to two and move every
scarcity rating in the app. The two orphan entries left behind in
`market-index.json` are unreachable from the catalog and clear on the next full
refresh.

### What the build measured, after

| | Before | After |
|---|---:|---:|
| Catalog species | 2,178 | 2,176 |
| Witness stores | 3 | 3 |
| Species with a scarcity rating | 475 | 474 |

The single rating that moved is Fish food losing its epic tier, which is the
whole point.

### A finding this turned up, not fixed here

`taxonomy.ts` documents `GENUS_FAMILY` as covering "every genus the catalog
contains". It covers 547 genera, and **945 catalog species have a genus in
neither it nor `MISSPELLED_GENERA`** - almost all legitimate marine fish that
arrived with LiveAquaria. `traitsFor()` therefore returns undefined for 43% of
the catalog, so those species get no family, no water zone and no organism
kind. That is a real gap in the card and filter data, and it is also why the
strongest possible binomial check - "is this a real genus?" - was not available
to this spec. Worth its own look.

## Testing

Unit:

- v0.3.0 scores market-only; the four retired components are absent from new
  snapshots and a stored v0.2.0 snapshot still renders all five.
- Tier cuts against the measured distribution, including that a refusal produces
  no snapshot rather than a zero.
- `revealSpecimen` returns a distinguishable refusal, marks Dream List
  fulfilment either way, and logs intent and outcome.
- `stockTank` writes holding, residency and event in the shape the importer
  writes.
- `deriveQuantity` rises on an "add more" event.
- The taxonomic gate rejects both phantoms and accepts a sample of real
  binomials, including a trinomial.
- The speciesId migration remaps every table and is idempotent.

Component:

- The reveal renders a profile with no portrait and with partial care data,
  drawing no placeholder for an absent fact.
- All three reveal non-negotiables still hold.
- A record with no label seals every other panel; setting one unseals them.
- `PriceForm` has no member field; a historical member price still displays.

Whole suite and `npm run build` green. 762 tests across 40 files at the close
of this spec, up from 712.

One thing learned the hard way and worth repeating: **`vitest run` does not
typecheck**. A fully green suite twice hid a type error that `npm run build`
caught immediately - once a fixture missing a required field, once an invalid
enum value. Run the build before claiming a change is verified.

## Files

- `src/ui/components/RevealCeremony.tsx` - profile instead of a name
- `src/ui/hooks.ts` - `useCatalogCard`
- `src/ui/screens/IdentifyFlow.tsx` - "Not yet" removed, uncatalogued escape
- `src/ui/screens/SpecimenDetail.tsx` - Identity, price, Discovery, placement
- `src/ui/screens/SpeciesDetail.tsx` - photo target, holdings in "Your fish"
- `src/ui/screens/Tanks.tsx`, `TankDetail.tsx` - add a fish, add more
- `src/engine/rarity/discovery-tier.ts` - v0.3.0
- `src/domain/types.ts` - optional retired components
- `src/data/repositories.ts` - `stockTank`, placement, refusal union, fulfilment
- `src/data/db.ts` - speciesId remap migration
- `etl/` - taxonomic gate
- `src/data/seed/marts/*.json` - regenerated, never hand-edited
