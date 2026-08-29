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
npm test             # 332 unit + integration tests across 15 files
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
| **1 — Private shell** | PWA installs and runs offline; drafts are created before media finishes writing; retries never duplicate a catch. No auth — see *No backend* below. |
| **2 — Catalog** | Species / specimen / encounter modelled separately; Unknown / Provisional / Confirmed identity; reveal ceremony; Dream List. The library is a **card grid of 1,076 species**, filterable by where a fish lives in the tank, what kind of thing it is, and temperament. |
| **3 — Real tanks** | Aquariums, holdings, dated residencies, full lifecycle events, inventory importer. |
| **4 — Evaluation** | Seven-factor deterministic screening over a versioned rule set, with immutable snapshots. |
| **5 — Price + journal** | Ask / member / paid kept separate, comparability filtering, story chapters. Prices come from **10 tracked vendors**, each store row linking straight to its product page. |
| **6 — Legacy + hardening** | Fish Heaven, Keeper's Code, JSON export, reduced-motion and mute, non-colour status cues. |

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
dataset. A species the vendors named but nobody has profiled carries **no care
data at all**, so screening it returns *Not enough data* rather than a guess.
Where a fact is unknown, the app says so and shows what it would need.

**3. It never rewrites history.** Correcting an identity supersedes the earlier
assertion rather than replacing it. Re-running a screening adds a snapshot
rather than mutating one. Moving a fish closes one dated residency and opens
another. A fish that dies stays in the tank history it lived through.

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
| Species in the catalog | **1,076** |
| Portraits bundled | **1,011 (94%)** — 22.3 MB at 480 px, ~22 KB each |
| ↳ from Wikimedia Commons, under a stated licence | 851 |
| ↳ from the open web, credited to the site | 100 |
| ↳ from a vendor product listing, credited to the shop | 60 |
| Rendering a silhouette | 65 |
| With a water-column zone | 956 (89%) |
| With a curated care profile | 47 |

The species dimension is derived from **what the vendors actually sell**, with
the curated care profiles as an enrichment layer on top. Building it the other
way round — matching listings to a hand-written seed — was an early design
error that left 96% of the library invisible.

A binomial the curated catalog does not cover mints a species from the name the
vendor stated explicitly. Note what this is not: it never guesses that one fish
is another. Discovered species carry no care data, deliberately, so the
compatibility engine returns *Not enough data* for them.

Portraits are precached (~22.3 MB, up from 14.9 MB when coverage went from 695
species to 1,011) so the library draws itself offline per NFR-02. The install
happens in the background after first paint and cards lazy-load, so it does not
sit in front of the first render.

**Known performance debt, logged rather than quietly accepted:** the marts are
inlined into the JS bundle (1,185 KB raw / 262 KB gzip) and should be separate
fetched assets, and all 1,076 cards render at once.

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
each family to a zone with the reason attached. **956 of 1,076 species (89%)**
get one; the rest say "not recorded" and are excluded from every zone filter
rather than defaulted into one.

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
species. Paste `Parachromis managuensis` and Jaguar Cichlid is first; paste a
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

Ten Shopify storefronts are tracked: Global Exoticquatics, J4 Flowerhorns,
Predatory Fins, Imperial Tropicals, Aquatic Arts, Aquarium Co-Op, Flip Aquatics,
AquaHuna, **Nu Aqua** (Orland Park IL, the first one you can walk into) and
**LiveAquaria**. Each was verified individually — Shopify, `robots.txt` permits
public product data, `/products.json` not disallowed. **15,434 listings.**

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
`dim_species` (Type 2 SCD), `dim_date`, `dim_image`, `fact_listing`,
`fact_price_observation`. The grain is one row per (store, variant,
snapshot_date), so re-running accumulates a real time series that no single
pull could contain. `warehouse/schema.sql` is portable DDL — Athena, BigQuery,
Snowflake, Databricks or Postgres can run it unchanged.

Details in [`docs/MARKET_ETL.md`](docs/MARKET_ETL.md) and
[`docs/DATA_WAREHOUSE.md`](docs/DATA_WAREHOUSE.md).

### Rarity is one score, not two

Market scarcity is a weighted **component** of the Discovery Tier
(`discovery-tier-v0.2.0`), not a separate rating: 35 first-confirmed species /
25 dream-list hit / 15 personal-encounter scarcity / 10 exceptional specimen /
15 market scarcity. Historical snapshots each store their own formula version,
so retuning the weights later leaves every past reveal exactly as the user saw
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
