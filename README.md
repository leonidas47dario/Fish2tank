# Fish2Tank

**Catch the encounter. Keep every story.**

An installable, mobile-first web app that turns fish-store visits into collectible,
story-rich records — without requiring a purchase. Photograph a fish, confirm what it is,
get an honest read on whether it could ever live in one of your real tanks, and keep the
story of the ones that mattered.

Built to the requirements in [`docs/PRD.md`](docs/PRD.md) (original: [`docs/Real_Life_Fish_Collection_App_PRD.docx`](docs/Real_Life_Fish_Collection_App_PRD.docx)).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm test             # 1,084 unit + integration tests across 62 files
npm run build        # type-check, bundle, generate the service worker
npm run preview      # serve the production build on :4173

# End-to-end: drives the whole Panther scenario through a real browser
npm run build && npm run preview &
npm run smoke

# Proves a new deploy is picked up on the first load, not the second
npm run verify:sw
```

Refreshing the shipped market data is a separate act from shipping code — see
[Data pipeline](#data-pipeline) below and [`docs/RELEASING.md`](docs/RELEASING.md).

---

## What actually works today

The **Catch → Evaluate → Reveal → Journal** loop runs end to end. The complete
nine-step Panther scenario from PRD section 10 is covered by an automated test
(`src/data/repositories.test.ts`) *and* by a browser smoke test that walks the
real UI.

| PRD slice (11.1) | State |
|---|---|
| **1 — Private shell** | PWA installs and runs offline; drafts are created before media finishes writing; retries never duplicate a catch. Catches can be corrected or deleted, with the cascade named before it happens. No auth — see *No backend* below. |
| **2 — Catalog** | Species / specimen / encounter modelled separately; Unknown / Provisional / Confirmed identity; reveal ceremony; Dream List. The library is a **card grid of 2,178 species**, filterable by where a fish lives in the tank, what kind of thing it is, and temperament. |
| **3 — Real tanks** | Aquariums, holdings, dated residencies, full lifecycle events, inventory importer. Each tank opens in two modes: a **Viewer** dashboard built to hand to a guest, and **Manage** for everything that writes. |
| **4 — Evaluation** | Seven-factor deterministic screening over a versioned rule set, with immutable snapshots. |
| **5 — Price + journal** | Ask / member / paid kept separate, comparability filtering, story chapters. Prices come from **12 tracked vendors**, each store row linking straight to its product page, and **8 Chicago PetSmart branches report what is in the tank today**. |
| **6 — Legacy + hardening** | Fish Heaven, Keeper's Code, JSON export, reduced-motion and mute, non-colour status cues. |

### Sharing a tank

Every tank card has a share icon. It publishes a **4 KB file** to R2 and gives
you a link anyone can open with no account: the fish, where they swim, what
they grow into, and the tank's estimated value. The page keeps itself current —
add a fish and the published copy is rewritten within seconds, so a link you
sent last month is not showing last month's tank.

Three properties worth knowing, because they are the design rather than
details:

- **Photos are not copied.** The published file names the photo it may show,
  and the Worker serves that one object from the bucket it already lives in.
  Nothing is duplicated, and revoking is a single delete that takes the page
  and the photo down together.
- **A guest can look, and must sign up to act.** Hearting a fish or opening its
  profile asks for an account, and the tap survives the sign-in — you come back
  to the tank with that fish already on your Dream List.
- **It is an unlisted link, not a private one.** Anyone holding the URL can
  read the tank, including its estimated value. That was a deliberate call
  (`docs/specs/019-share-a-tank.md`); the sheet says so in words before you
  share.

**Sharing needs the media Worker deployed for that tier.** A build with no
Worker configured — any local or preview build — says so in the share sheet
rather than offering a button that does nothing. See `docs/RELEASING.md`.

### Deliberately not built yet

All of these are **P1 or P2** in the PRD's own priority legend, so none of them
block a first usable release:

- Audio and video *memos*, and transcription (FR-J02, FR-J03). Video files are
  accepted as encounter media; a recorded memo attached to a chapter is not.
- Geolocation capture — a favourite store is seeded, but there is no permission flow (FR-C03)
- Opt-in "finish your story later" reminder (FR-C08)
- User override on a verdict — modelled in the types, no UI (FR-E08)
- AI explanation of a verdict (FR-E09)
- Size-over-time tracking (FR-T07)
- Restore from an export — export works, import does not

---

## Three things this app refuses to do

These are the product's spine, not implementation details, and each is enforced
by tests rather than by convention.

**1. It never infers safety from missing data.** A tank with no recorded
dimensions returns *Not enough data*, never *Suitable*. Five of the six seeded
enclosures ship unmeasured on purpose — the honest consequence is visible
immediately, and measuring them once is what makes every later check real.

**2. It never invents a number.** No confidence percentage on a manual
identification. No median price below the minimum sample count. No bioload
calculation from a "Crowded" checkbox. No Chicago rarity without a community
dataset. Where a fact is unknown, the app says so and shows what it would need.

Care data is where this rule is now *mechanically enforced* rather than merely
observed. Every backfilled value carries the verbatim sentence it came from,
and `etl/ingest-care-proposals.ts` checks that sentence is really in the cached
source text **and** that it really contains the figure attributed to it. A
fabricated number cannot reach the catalog, because the sentence it claims to
come from is not on disk. What no source states stays empty: 90% of the
catalog still has no minimum tank volume, so screening those species returns
*Not enough data* rather than a guess. That gap is the honest outcome of
refusing to fill it.

**3. It never rewrites history.** Correcting an identity supersedes the earlier
assertion rather than replacing it. Re-running a screening adds a snapshot
rather than mutating one. Moving a fish closes one dated residency and opens
another. A fish that dies stays in the tank history it lived through.

*You can still edit and delete your own catches, and that is not a contradiction.*
Correcting a mistyped date or a nickname makes the record **true**; it is the
species, the verdicts and the tiers — the things the app concluded — that are
superseded rather than overwritten, so the edit form deliberately has no species
field. And deleting says *this encounter never happened* — a mis-tap, a
duplicate, test data — which is a different claim from *I was wrong* or *it
died*, both of which have their own paths that keep the past. A catch held in a
tank or carrying a memorial cannot be deleted at all; the app says so and points
you at the tank instead.

---

## Architecture

```
src/
├── domain/        Types for the 18 entities in PRD section 6, plus pure
│                  derivations (quantity, residency, badges, tankmates)
├── engine/        The three deterministic systems. No I/O, no React, no model calls.
│   ├── compatibility/   PRD 5.1/5.2 — seven factors, versioned rules
│   ├── rarity/          PRD 5.3   — Discovery Tier v0.2.0 (market scarcity merged in)
│   └── pricing/         PRD 5.4   — comparability and price fit
├── data/          Dexie/IndexedDB schema, repositories, importer
│   └── seed/      Hand-maintained source (species-catalog.ts, fish_inventory.csv,
│                  assets/) plus marts/ — generated, never hand-edited
├── theme/         Design tokens (PRD 7.3) and the three territories (7.2)
├── pwa.ts         Service-worker registration and the reload-on-new-build rule
└── ui/            Screens and components — consume tokens only, never literals

etl/               The refresh pipeline: vendor scrape → normalize → warehouse → marts
                   sources/ holds one reader per platform over a shared polite client
warehouse/         Parquet star schema + schema.sql, the portable migration contract
scripts/           smoke.mjs (full-UI walkthrough), verify-sw-update.mjs
docs/              PRD, plus DATA_WAREHOUSE / MARKET_ETL / INVENTORY_IMPORT / RELEASING
```

The engines are pure functions of `(stored inputs, versioned config)`. That is
what makes principle **P5 — "Rules before AI"** enforceable: a verdict is
reproducible, inspectable, and stamped with the rule version that produced it.
`src/ui` contains no colour, radius or duration literal, which is what makes a
theme swap provably incapable of touching a record or a calculation.

### Generated vs hand-written

Anything under `src/data/seed/marts/` is build output and is overwritten by the
next refresh. Everything else under `src/data/seed/` is maintained by a person.
That split is the whole convention — see
[`src/data/seed/marts/README.md`](src/data/seed/marts/README.md).

### No backend

Everything — records and original media blobs — lives in IndexedDB on the
device. PRD 12.1 leaves the cloud/auth provider explicitly open, and PRD 2.2
requires the product to be worthwhile for one person with no community at all.
So the sync seam exists (`syncState` on media and encounters) but points
nowhere yet. Nothing leaves the device.

---

## The catalog

The library is a Hearthstone-style card grid, not a text list. Every species is
a card; the ones you have caught or keep are in colour, the rest greyed and
locked. There is one browser, not a "mine" screen and an "all" screen —
`/collection` redirects to `/catalog`, since it was the nav item for three
releases.

Gem positions are borrowed deliberately. A card game trains the eye to find
cost at the top-left, so that holds market price; adult size and minimum tank
volume sit bottom-right — the three numbers a keeper actually decides on.

**The tiles are landscape, because the photographs are.** 879 of the 1,011
bundled portraits (87%) are wider than they are tall, at a median aspect ratio
of 1.50. The card used to be 3:4 with `object-fit: cover`, so a 3:2 photograph
kept about 37% of its width and the crop went straight through the fish — head
and tail outside the frame, a belly in the middle. Matching the tile to the
source is the only thing that fixes that; no amount of `object-position` tuning
saves a portrait box fed landscape images. A fish is a long horizontal animal,
so it is also just the right shape for the subject.

| | |
|---|---|
| Species in the catalog | **2,178** |
| Of those, sold only by marine vendors | 1,057 |
| Portraits bundled | **1,011 (46%)** — 22.3 MB at 480 px, ~22 KB each |
| ↳ from Wikimedia Commons, under a stated licence | 851 |
| ↳ from the open web, credited to the site | 100 |
| ↳ from a vendor product listing, credited to the shop | 60 |
| Rendering a silhouette | 1,167, most of them the newly added marine species |
| With a water-column zone | 1,080 — **977 of 1,121 (87%) freshwater**, 103 of 1,057 marine |
| With any care data | 697 — **697 of 1,121 (62%) freshwater**, 0 of 1,057 marine |
| ↳ hand-curated profile | 47 |
| ↳ backfilled from cited sources | 658 |

**Two of those numbers moved sharply on 2026-08-29 and neither is a
regression to hide.** Adding PetSmart and Petco meant re-reading every existing
vendor, and their catalogues had grown — LiveAquaria alone went from a sampled
slice to 3,256 products. The species dimension doubled to 2,178, half of it
reef fish. So portrait coverage fell from 65% to 32% and pooled water-zone
coverage from 89% to 50%, purely by denominator. Backfilling ~1,100 portraits
is a separate, deliberate act (see `docs/plans/002-portrait-backfill.md`) — it
roughly doubles the 14.9 MB precache budget, which is a product decision rather
than a build step. Extending the taxonomy map to reef families is likewise real
taxonomy work, not a threshold tweak, and `taxonomy.test.ts` now asserts the
freshwater coverage and the marine gap separately so neither can hide inside an
average.

The species dimension is derived from **what the vendors actually sell**, with
the care profiles as an enrichment layer on top. Building it the other
way round — matching listings to a hand-written seed — was an early design
error that left 96% of the library invisible.

A binomial the curated catalog does not cover mints a species from the name the
vendor stated explicitly. Note what this is not: it never guesses that one fish
is another.

### Care coverage, per field

96% of the freshwater catalog had no care data at all until the spec 003
backfill read the source documents for it. Shares below are **of the 1,121
freshwater species**, which is the population the backfill ran against;
against all 2,178 including the marine half they roughly halve.

| Field | Species | Share of freshwater | Backfilled |
|---|---:|---:|---:|
| Adult size | 689 | 61% | 642 |
| Temperature range | 217 | 19% | 170 |
| Temperament | 206 | 18% | 159 |
| Minimum tank volume | 92 | 8% | 45 |

Reported per field, because a single coverage number would hide the shape of
it. Wikipedia states a body length for most species it covers and a minimum
tank volume for almost none, so **most species still screen as *Not enough
data***, which is the correct answer while no source states the figure. The
hand-curated 47 are never overwritten: the backfill fills gaps only, so a
scraped sentence can never overrule a person.

**The 1,057 marine species have no care data.** They entered the catalog in
the same-day vendor expansion that doubled it, after this backfill had already
read its sources. Re-running the pipeline over them is `npm run care:fetch`
followed by a fresh extraction pass; it has not been done, and the table says
so rather than averaging the gap away.

Every backfilled value links to the sentence it came from, per field — a fish's
size can come from Wikipedia while its tank volume comes from a store listing,
and the species page credits each separately. The sentences themselves live in
`src/data/seed/species-care.json`, which is the audit record.

Portraits are precached (~22.3 MB, up from 14.9 MB when coverage went from 695
species to 1,011) so the library draws itself offline per NFR-02. The install
happens in the background after first paint and cards lazy-load, so it does not
sit in front of the first render.

**Known performance debt, logged rather than quietly accepted:** the marts are
inlined into the JS bundle (2,944 KB raw / 456 KB gzip, up from 1,185/262 —
the catalog doubled, the index now publishes 2,176 species rather than 310,
and the care backfill added ~46 KB gzip of values and per-field credits) and
should be separate fetched assets, and all 2,178 cards render at once. That
growth makes both halves of the sentence considerably more urgent.

---

## Catalog data quality

The species dimension is derived from vendor listing titles, and a vendor title
is marketing copy, not a taxonomy. Left unchecked that produced **283 of 1,080
species (26%) with unusable names** — fourteen different fish all called
`- tank bred`, others called `BredBy Aquatic Arts` or `-Pack Of Fish`.

Three things fixed it, in that order:

1. **The parser.** `deriveCommonName()` ranked the shared *suffix* of a set of
   titles, and vendors put their boilerplate at the end, so the boilerplate was
   always what they had in common. It now cuts the title at the binomial and
   ranks suffixes of the **head** — `"Red Robin Gourami (Trichogaster labiosa) -
   Tank Bred"` yields `Gourami`, not `- Tank Bred`. That one change recovered
   221 of the 234 broken names on its own.
2. **[`species-overrides.ts`](src/data/seed/species-overrides.ts).** 94 sourced
   corrections for what no parser can reach — nothing recovers "Convict Cichlid"
   from six listings that all just say "Cichlid". Every entry cites a Wikipedia
   article or the vendor title that named the fish, and one is deliberately
   `null`: *Cherax boesemani* has no species-level common name, only four
   contradictory trade strains, so the card shows the binomial.
3. **A build gate.** [`catalog-quality.test.ts`](src/data/seed/catalog-quality.test.ts)
   fails CI if any of it comes back, and `npm run marts` exits non-zero rather
   than reporting success over a catalog it just poisoned.

The review also caught duplicates nobody had noticed: `Symphysodon
aequifaciatus` and `aequifasciata` are both misspellings of *aequifasciatus*,
and `Xiphophorus helleri` is a known orthographic error for *hellerii*. Four
records, three fish. They are dropped from the catalog and recorded in
`SPECIES_SYNONYMS` — **their price listings are not yet pooled into the
canonical record**, because that needs a full vendor re-scrape.

**Result: 254 quality problems → 0, with 0 species falling back to a bare
binomial.**

### The gate earning its keep, a second time

The 2026-08-29 refresh re-read every vendor and the catalog doubled. The gate
caught 29 new problems and refused to build, which is exactly what it is for.
Two different causes, two different fixes:

- **A parser bug, worth 246 listings.** Imperial Tropicals had started filing
  its odds and ends under `product_type` values like `"Other catfish"` and
  `"Other loricariids"`. Both have the exact Capitalised-word lowercase-word
  shape of a binomial, so the product-type path minted them as species — one
  of them a bucket holding eight unrelated fish under the name "Catfish". The
  fix is a `NOT_A_GENUS` guard: an English determiner is never a genus.
- **28 species that simply needed a person.** Six different fish had derived
  down to "Cichlid", three to "Gourami". Each was looked up and given a sourced
  override — Wikipedia where it names a vernacular, the vendor's own title
  marked `viaVendor` where it does not, and `null` for two *Caridina* and
  *Neocaridina* shrimp whose only names on offer are contradictory colour
  strains, so the card shows the binomial.

## Fresh or salt, and why the catalog opens on freshwater

**The catalog defaults to freshwater only.** Every tank the owner keeps is
fresh, and 868 of the 2,178 species are reef stock that arrived with
LiveAquaria's marine catalogue — opening the library on a wall of clownfish and
Acropora makes it somebody else's hobby. The chips sit above the fold rather
than in the "More filters" drawer, because every other filter starts at *any*
and this one starts *on*: a default that quietly removes 40% of the library
from behind a fold is exactly the thing this app refuses to do. When it hides
anything it says how much, broken down so the parts sum to the total.

| | Species |
|---|---|
| Freshwater | **1,264** |
| Saltwater | 868 |
| Brackish | 8 |
| Not recorded | 38 (1.7%) |

**The tag comes from the trade, not from the fish.** There is no licensed care
database yet, and deriving salinity from taxonomy would be the same invented
fact the aggression rating refuses to be — Gobiidae holds the bumblebee goby
and a hundred reef gobies. What *is* available is that vendors sort their own
shops by it: LiveAquaria tags "Marine Fish", "Freshwater Fish" and "Corals",
Aquatic Arts tags "Freshwater Shrimp", Predatory Fins tags four of its products
"Marine / Saltwater Fish". Those per-product tags win; a whole-vendor
declaration is only a fallback for the nine freshwater specialists that tag
nothing.

That ordering mattered more than expected. LiveAquaria had been declared
`marine` wholesale on the grounds of being "overwhelmingly marine", and it was
measurably wrong — **1,147 of its livestock listings are tagged freshwater, and
the blanket declaration was filing roughly 180 freshwater species under
saltwater.** It now declares `mixed`, meaning *do not assume*: only its own
tags may speak for it.

Where a species is tagged two ways, **freshwater wins**. All twelve conflicts
are genuinely euryhaline — Amano shrimp, archerfish, bumblebee goby, sailfin
molly — and someone filtering to freshwater wants to be shown a molly. Brackish
outranks saltwater for the same reason: it is the closer of the two to a tank
you could actually run. A species nobody tagged is *not recorded* and is
excluded from every specific choice rather than defaulted into one, the same
rule the water-column zone follows.

## Showing someone your tank

A tank page used to be an inventory list, which is the right tool for the
keeper and the wrong one for the person standing next to the glass. Each tank
now opens in two modes, and they are separate because they serve different
people at different moments — a guest tapping around your tank should not be
able to retire a fish by accident.

**Viewer** answers what a visitor actually asks. How many fish, how many
species, what it is worth, what the biggest one grows to. Where everyone swims,
drawn as bands in the order the fish occupy them — the geometry carries the
depth, so no colour ramp is needed and no legend has to be read. The
temperament mix, in the same severity vocabulary the verdict badges already
use, because a second visual language for one idea is how a design system rots.
What the tank *becomes*, since the two-inch fish in front of them is a
fourteen-inch fish later. Then the fish themselves as portraits you can tap
through to the species page.

**Manage** is everything that writes: move a fish, record a loss, set the
measurements.

**The index is a way in, not a second workspace.** It used to render every
tank's full resident list along with move and record-a-loss controls — the same
job the Manage tab does, in the wrong place, since a list answers *which tank?*
rather than *what do I do with this fish?*. It is now a card per tank: a photo
you can upload, the numbers worth a glance, and a tap to open. The tank rows on
Home open the same screen, which they previously did not — inert text put the
one screen a visitor is shown two taps behind a nav item.

`Aquarium.photoMediaId` had been in the schema since it was written and nothing
ever filled it. A tank photo is now a real Media row, so it obeys the same rules
as every other picture here — bytes stored inline, original never downsampled.
It carries no encounter and no specimen, because a photo of the glass is not a
sighting of a fish and must never be counted as one, and replacing it deletes
the old bytes rather than quietly growing the device's storage on every retake.

**Every total reports its own denominator.** Twelve of the sixty-one seeded
holdings are labels nobody could resolve to a species, and the 75-gallon's
estimate covers 10 of its 22 fish. The dashboard says so, in the panel named
*What this leaves out*, rather than averaging over 80% of a tank and presenting
it as the tank. That is the same rule the rest of the app follows, applied
where it is most tempting to break.

**On chart colour.** The fills are `color-mix` against the theme tokens, so the
whole dashboard re-themes with everything else and `src/ui` still names no
colour. The direction of that mix was measured, not eyeballed: mixing toward
the *surface* is the intuitive move and it put the light theme's bars at
**1.75:1**, well under the 3:1 floor for a mark. Mixing toward the *ink*
instead raises contrast in every territory at once, because the token flips
with the theme. Measured live in all three: 3.56:1 at worst.

## Where a fish lives

Every card carries a glyph for its water column zone — top, mid, bottom or all
levels — and the catalog filters on it, because "the bottom is full, what goes
up top?" is the question a keeper actually asks.

There is no machine source for this. FishBase and Wikidata are both unreachable
from the network this was built on, and Wikipedia's prose does not reliably say
it — the *Hypostomus plecostomus* article runs 6,500 characters without once
using the phrase "bottom-dwelling". What **is** reliable is taxonomy: the
binomial gives you the genus, genus→family is stable and checkable, and
water-column habit is overwhelmingly a family-level trait. So
[`taxonomy.ts`](src/data/seed/taxonomy.ts) maps 560 genera to 221 families and
each family to a zone with the reason attached. **1,063 of the 1,162 freshwater
animals (91%)** get one; the rest say "not recorded" and are excluded from every
zone filter rather than defaulted into one.

**It is a freshwater map, and the catalog now says so out loud.** The 2026-08-29
refresh brought LiveAquaria's full marine catalogue — 868 reef species, whole
genera the map was never built for: *Chaetodon*, *Cirrhilabrus*, *Acropora*.
Pooled zone coverage therefore reads 49% while freshwater animals sit at 91%.
Plants are excluded from that denominator on purpose: the app never assigns a
zone to a plant, so counting the 142 freshwater plants among the species that
ought to have one was always measuring the wrong thing. It went unnoticed while
180 freshwater species were mis-filed as marine and so left out of the count
entirely. Averaging those two would have reported a stale genus map when nothing
had gone stale, so `dim_species` now carries a `water_type` tagged **from the
vendors that list a species, never inferred from the fish** — `StoreConfig`
has declared that intent since LiveAquaria was added and this is where it
finally gets applied. `taxonomy.test.ts` asserts the two halves separately: the
freshwater catalog above 85%, and the marine gap as a known, sized hole that
must stay unclassified rather than be defaulted into "mid" because most fish
are. Extending the map to reef families is real taxonomy work, not a threshold
tweak.

**Temperament is deliberately not derived this way.** Cichlidae holds both the
ram and the jaguar cichlid, so a family-level aggression rating would be exactly
the invented data this app refuses. It stays per-species and curated, and the
filter says so.

## Catch → identify → reveal

Capture now runs straight into naming the fish instead of dropping you on the
full record to go and find the identity block.

**On Google Lens:** there is no public API, and Cloud Vision would need a
billing-backed key plus shipping your photo to Google. PRD **FR-I03** anticipated
this exactly — *"the product does not claim embedded Google Lens capability; the
user returns and confirms the result manually"* — so the photo goes to Lens only
through a share sheet you tap, and the app does the half that actually saves
taps: turning whatever text comes back into a ranked shortlist of real catalog
species.

**The share carries the image and nothing else, and that is load-bearing.** It
used to send a title and a caption alongside the photo. A share carrying text is
a different kind of share: the receiving app gets a text payload too, and Chrome
on iOS acts on the words — opening a tab, or searching for them — instead of
routing the image into Lens. Picture-plus-caption also reads to iOS as a
message, which is why its sheet led with contacts. Neither string was read by
anything; Lens wants a picture. `identify.test.ts` asserts the payload has
exactly one key.

**No web page can choose which app receives a share.** `navigator.share()` has
no target parameter on any platform, by design — the OS owns that choice, and on
iOS the order of the sheet is Apple's, learned from what you actually pick.
Sending a clean image share is the whole of what a web app is allowed to
influence, so that is what this does. Paste `Parachromis managuensis` and Jaguar Cichlid is first; paste a
whole messy Lens caption and it still resolves; type `freshwater aquarium fish`
and it matches **nothing**, rather than ranking the catalog by how often the word
"fish" appears.

Nothing is ever auto-confirmed. Ordering is the only confidence signal shown,
never a percentage (FR-I04).

Confirming plays the unlock ceremony from PRD 7.5 — card rise, bubble burst,
name, tier stamp — inside a 2.15s budget, skippable at any frame, with
synthesized audio and haptics behind the existing mute switch (which defaults to
on). Reduced motion renders the final frame with no animation at all, not a
faster one.

## Data pipeline

Twelve vendors are tracked. Ten are Shopify storefronts: Global Exoticquatics,
J4 Flowerhorns, Predatory Fins, Imperial Tropicals, Aquatic Arts, Aquarium
Co-Op, Flip Aquatics, AquaHuna, **Nu Aqua** (Orland Park IL, the first one you
can walk into) and **LiveAquaria**. Each was verified individually — Shopify,
`robots.txt` permits public product data, `/products.json` not disallowed.

The other two are big-box chains, added 2026-08-29, and they gave opposite
answers to the same question. **Permission was checked per host, not per
brand.**

**PetSmart** publishes everything needed and says so in `robots.txt`: the
sitemap index, schema.org `Product` JSON-LD on every product page, and — named
explicitly as `Allow:` for every user agent — an inventory search endpoint that
reports **on-hand counts per sku per store**. That is a first for this dataset.
Every other vendor answers *can this be shipped to me*; PetSmart answers *is it
in a tank twenty minutes away right now*. 254 live listings, and 2,032 on-hand
rows across all eight Chicago branches.

**Petco is one brand behind two different doors.** `stores.petco.com` is wide
open — no `Disallow` rules at all — and publishes each branch as schema.org
`PetStore` including the departments it runs, which answers something the
prices never could: **seven of the eight Chicago branches keep fish.**
`www.petco.com` is the opposite: HTTP 403 from the CDN edge to every automated
request, `/robots.txt` included, identically with a browser User-Agent.

The listings reader is built and wired in anyway, because **that block is a
property of the network, not of the code** — bot managers of that class refuse
cloud egress and pass ordinary residential traffic, so the same run from your
laptop may go straight through. `probeStorefront()` asks on every run and the
answer becomes data: allowed → walk the sitemap and read the product JSON-LD;
refused → keep the locations and write the reason into `market-index.json` as
`sources[].accessNote`, so a zero next to Petco is always explained rather than
mistaken for a broken pipeline. From this machine it currently reads *403 — the
CDN edge refuses automated clients from this network.*

Two rules that do not bend: permission is checked **per host, not per brand**,
and a refusal is never routed around — no disguised User-Agent, no proxy, no
scraping a cache. Until it says yes, the nearest honest stand-in for Petco's
prices is LiveAquaria, Petco's own aquatics brand, already tracked.

**Neither chain is Shopify, and that shaped the design.** There is no
`/products.json` and no shared platform, so the pipeline is built around what
they *do* maintain for machines: schema.org `Product` JSON-LD, which every
SEO-driven retailer publishes because Google needs it to show a price. That
contract lives in `etl/sources/schema-org.ts` and both readers share it — a
third non-Shopify vendor needs a sitemap filter and a store-number rule, not a
new parser.

**24,624 listings.**

Chicago is the sampled city because that is where the owner shops. Both chains
are read city-wide — eight branches each — rather than hand-picked, so "no
Chicago store has it" means something. `SAMPLED_CITY` moves the sample in one
line.

Two things the branch data deliberately does *not* do. It never feeds the
Discovery Tier: eight branches of one chain measures that chain's buying, not
how hard a fish is to find (`FR-P05`, `FR-R07`). And it never flattens "the
store carries this and has none today" into "the store does not carry this" —
the vendor reports those differently, they answer "is it worth driving there"
differently, and they are stored differently.

```bash
npm run refresh            # etl → images → portraits → warehouse → marts
npm run etl -- --offline   # rebuild from cached raw snapshots, no network
```

The pipeline is **not scheduled**, on purpose: a refresh is a deliberate act
that produces a reviewable diff, so a vendor's pricing change cannot silently
alter what production shows. These are small businesses' servers — the client
identifies itself with a contactable User-Agent, waits between requests,
honours `Retry-After`, backs off on 429/5xx, and caps pagination. Do not raise
the concurrency.

Output lands in a **Parquet star schema** under `warehouse/`: `dim_store`,
`dim_species` (Type 2 SCD), `dim_date`, `dim_image`, `dim_local_store`,
`fact_listing`, `fact_store_inventory`, `fact_price_observation`. The listing
grain is one row per (store, variant, snapshot_date), so re-running accumulates
a real time series that no single pull could contain; the branch-stock grain is
one row per (branch, sku, snapshot_date), kept apart because a count in one
building that changes hourly is not the same kind of fact as a published price. `warehouse/schema.sql` is portable DDL — Athena, BigQuery,
Snowflake, Databricks or Postgres can run it unchanged.

Details in [`docs/MARKET_ETL.md`](docs/MARKET_ETL.md) and
[`docs/DATA_WAREHOUSE.md`](docs/DATA_WAREHOUSE.md).

### The care backfill

A separate pipeline, run deliberately and rarely, specified in
[`docs/specs/003-care-profile-backfill.md`](docs/specs/003-care-profile-backfill.md):

```bash
npm run care:fetch     # cache Wikipedia + vendor prose to data/care/text/
npm run care:plan      # split what has text into agent batches
#                        (extraction agents read the cache and write proposals)
npm run care:ingest    # verify every quote, then write species-care.json
npm run marts          # overlay the result onto the catalog
```

Fetch and ingest are separate steps so a bad extraction never costs a re-fetch,
and so the text a claim came from is still on disk when the gate checks it.
`care:fetch` is idempotent — a second run makes zero network calls, including
for the 246 species with no article, whose absence is remembered rather than
re-asked. The cached prose is gitignored (it regenerates, and it is several
megabytes that churn on every Wikipedia edit); the derived records beside it
are committed, because those are the audit trail.

### Species the keepers found first

The catalog is incomplete by construction — it is derived from what a set of
vendors happened to be listing, and a shop will sell a fish none of them
carried. When a keeper searches the catalog and nothing fits, they log the name
as-is; that becomes a `user-submitted` species on their device, provisional,
with their exact wording kept as the evidence.

Those never reach the shared catalog on their own. A maintainer reviews them:

```bash
npm run species:review -- --export ~/fish2tank-export.zip
npm run species:review -- --export ~/fish2tank-export.zip --accept sp_user_abc
npm run marts          # fold the accepted ones into the catalog
```

The export is the backup archive from the Settings screen. The older flat JSON
export is still accepted, so a backup taken before spec 006 still reviews; the
format is read from the file's first bytes rather than its extension.

Listing is the default and writing takes an explicit decision. The gate rejects
blanks and placeholders outright, and flags anything that looks like it is
already in the catalog — naming the entries it might be — so the common failure
(re-adding "Congo Tetra" under a second id) has to be overridden deliberately
rather than slipped past. `--accept-all` means "everything the gate cleared",
never "override the gate".

A promoted species carries a name and nothing else: no adult size, no
temperament, no portrait. One person's reading of a store tag is a name, not a
care profile, and the backfill above can source the rest later the same way it
does for anything else. The one quality rule they are exempt from is the ban on
digits in a name, because L-numbers (L083, L046) are the standing designation
for the undescribed Loricariids that have no binomial at all — the exact fish a
vendor-derived catalog is most likely to be missing. Everything else the gate
checks still applies to them.

Keepers reach the tool through the export on the Settings screen (NFR-08);
there is no backend, and this pipeline does not add one.

**What this machine cannot reach.** FishBase, SeriouslyFish and Wikidata all
return 503 through DRW's Menlo Security proxy, as do two of the eight vendor
hosts — 233 Predatory Fins listings and 10 Aquatic Arts ones are unreachable
here and are recorded as skipped rather than retried into a wall. The care
databases that would answer this question properly are simply not available
from this network.

### Rarity is one score, not two

Market scarcity is a weighted **component** of the Discovery Tier
(`discovery-tier-v0.2.0`), not a separate rating: 35 first-confirmed species /
25 dream-list hit / 15 personal-encounter scarcity / 10 exceptional specimen /
15 market scarcity. Historical snapshots each store their own formula version,
so retuning the weights later leaves every past reveal exactly as the user saw
it.

That market component is now **local-shelf scarcity**
(`market-scarcity-v1.0.0`): how many of the general shops that resemble a local
shelf carry the fish, and nothing else. Specialist importers are excluded from
the sample, and a shop's silence counts as evidence only where that shop
demonstrably resolves its own catalogue. Price and stock were dropped - one is
a consequence of rarity rather than evidence of it, the other tracked Shopify
leaving sold-out products published. See
[`docs/specs/004-local-shelf-scarcity.md`](docs/specs/004-local-shelf-scarcity.md).

Three shops currently qualify as witnesses - Imperial Tropicals, AquaHuna and
**Nu Aqua**, the one vendor in the list you can walk into. Neon Tetra,
Cardinal Tetra and Bristlenose Pleco read *widely available*; Oscar and Jack
Dempsey read *available*. Nothing reads *rarely listed*: that takes five
witnesses, and the rating declines its strongest word until the sample earns
it.

---

## Real data, seeded

The app opens on Ryan's actual system, not an empty shell:

- **All 61 inventory rows** across the six real enclosures, imported as opening
  balances from [`docs/fish_inventory.xlsx`](docs/fish_inventory.xlsx)
- **47 curated species profiles**, covering the fish that are actually in those tanks
- **The Panther**, with the real encounter photo, $100 asking / $75 member, and
  the story

Which makes the screening real. Ask the app where a 14″ jaguar cichlid could
live and it answers *Extreme risk* for every tank Ryan owns — naming the wolf
fish it would fight, the Geophagus it would kill, and the 125-gallon minimum a
75-gallon tank cannot meet. That is the product's whole thesis working: the
honest answer was always "nowhere", and the app says so without needing him to
buy anything to find out.

### A fish you keep is yours

An imported opening-balance holding has no specimen — `Holding.specimenId` is
optional by design (FR-T02), because an inventory row records a fish you own
without any encounter having happened. Ownership is therefore derived from
holdings *and* specimens in one place (`catalog.ts`), not per screen. Before
that fix, 1 card rendered in colour; after it, 43.

Photos can go onto anything you own. The species page mints the specimen the
holding always implied and puts the identity through `assertIdentity` with
source `import`, so "how do we know what this is?" stays auditable instead of
being stamped onto the row. Tapping one of your own photos makes it the card's
face.

## About the species data

Per your decision, **Wikipedia is the placeholder source** until a licensed
care database is chosen (PRD 12.1). Every curated profile carries a real
article URL.

**Portraits come from three places, and each says which.** Wikimedia Commons
files carry a stated licence and credit the photographer. Vendor product
listings and open-web photos carry no licence, and are used by your decision
(spec 002) for the species Commons will never cover: line-bred colour morphs,
hybrids, and fish described too recently for anyone to have photographed them
freely. Those render as `Photo: Imperial Tropicals (product listing)` rather
than borrowing the shape of a licence line, because implying a licence nobody
granted would be the actual dishonesty.

The rule an image must pass is **traceability, not licensing**: every shipped
portrait carries a provenance and a URL you can open to see where it came
from. An image we cannot account for is still dropped rather than shipped
hopefully.

One caveat worth keeping in view: Wikipedia species articles are good on
taxonomy and adult size, and **thin on exactly what this engine screens** —
minimum tank volume, aggression rating, prey-size behaviour. Those fields are
hobbyist consensus, and each profile's source note says so rather than implying
the article backs them.

Eleven inventory labels are **deliberately left unresolved** — the unclear IDs
you had already flagged, plus genus-only and ambiguous trade names like
`Severum (unspecified)` and `Striped cory`. They stay raw, and screening for
them says *Not enough data*. A guess there would be the fastest way to make the
app dishonest, so there is a test that fails if anyone later adds one.

## The verdict-precedence decision, plainly

You said this one wasn't clear — here it is without the jargon.

A tank can trip two rules at once: one that's *definitely* fatal, and one the
app *can't check*. Say a fish would certainly eat your tetras, and separately
you never recorded that tank's temperature.

Two possible answers:

- **"Not enough data"** — technically true, but it buries the fact that you
  already know this fish will eat your tetras.
- **"Extreme risk"** — tells you the thing that actually matters, and still
  lists the temperature as unchecked underneath.

This build picks the second. The one rule that never bends: **missing data can
never produce a green "Suitable"**. So nothing unsafe slips through — you just
get told the worst *known* problem first instead of a shrug. That matches what
the PRD actually requires (FR-E05 says don't infer *safety*; measure 11.2 says
missing inputs must not yield *Suitable*), and PRD 5.2 never said which
of the two wins.

If you'd rather it always say "Not enough data" the moment anything is
unchecked, that's a one-line change in `engine.ts` — the ordering is a single
constant.

---

## Environments

Two environments publish from one GitHub Pages site, built by
`.github/workflows/deploy.yml`:

```
feature branch  ──▶  uat  ──▶  main
                     │          │
                     ▼          ▼
              /Fish2tank/uat/  /Fish2tank/
                 staging        production
```

| Branch | URL | Purpose |
|---|---|---|
| `uat` | https://leonidas47dario.github.io/Fish2tank/uat/ | Every change lands here first and is exercised live |
| `main` | https://leonidas47dario.github.io/Fish2tank/ | Production. Only ever receives merges from `uat` |

**Nothing goes to production without having been live on `/uat/` first.**

GitHub Pages serves one site per repository, so both branches are checked out,
built with their own base path, and published as a single artifact. The
consequence worth knowing: **a push to either branch rebuilds both**, and both
builds run the tests.

Staging lives underneath production's path, so production's service worker
scope contains `/uat/`. Production disowns it via `navigateFallbackDenylist`,
and staging installs as *Fish2Tank (UAT)* so it cannot be mistaken for
production on a home screen.

A new build is picked up on the **first** load rather than the second:
`src/pwa.ts` reloads once on `controllerchange`, guarded so the first-ever
visit does not flash for nothing. `npm run verify:sw` proves it end to end.

The workflow enables Pages itself on first run (`enablement: true`), so no
manual setup is needed. If you ever need to set it by hand, it is Settings →
Pages → Source: **GitHub Actions**.

Pages on a *private* repository needs a paid GitHub plan. This repository is
public, so the free plan covers it. To host it privately instead, the build is
fully static and Netlify, Cloudflare Pages or Vercel will each serve it from a
private repo on their free tier — build command `npm run build`, publish
directory `dist`, and leave `VITE_BASE` unset since those hosts serve from the
root.

Because there is no backend, "deployed" means the app is installable from that
URL and then runs entirely on the device. Data never leaves the phone, and it
keeps working offline once installed.

Full promotion and refresh procedure: [`docs/RELEASING.md`](docs/RELEASING.md).

---

## Art direction is still open

PRD section 7 deliberately leaves the visual language undecided. All three
territories from 7.2 ship as switchable token sets so the 7.6 acceptance test
can be run: **the same Panther, on Evaluate / Reveal / Journal, in all three.**
Switch under Settings → App theme.

- **Midnight Aquarium** — dark gallery, luminous media, restrained foil
- **Playful Collector** — bright aquatic colour, rounded cards
- **Expedition Fieldbook** — warm paper, serif type, annotated dossier

Shipping several production themes is explicitly *not* a release requirement.
Pick one default; the token contract is what has to survive.
