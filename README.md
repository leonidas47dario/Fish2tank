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
npm test             # 165 unit + integration tests
npm run build        # type-check, bundle, generate the service worker
npm run preview      # serve the production build on :4173

# End-to-end: drives the whole Panther scenario through a real browser
npm run build && npm run preview &
npm run smoke
```

---

## What actually works today

The **Catch → Evaluate → Reveal → Journal** loop runs end to end. The complete
nine-step Panther scenario from PRD section 10 is covered by an automated test
(`src/data/repositories.test.ts`) *and* by a browser smoke test that walks the
real UI.

| PRD slice (11.1) | State |
|---|---|
| **1 — Private shell** | PWA installs and runs offline; drafts are created before media finishes writing; retries never duplicate a catch. No auth — see *No backend* below. |
| **2 — Collection** | Species / specimen / encounter modelled separately; Unknown / Provisional / Confirmed identity; reveal ceremony; Dream List. |
| **3 — Real tanks** | Aquariums, holdings, dated residencies, full lifecycle events, inventory importer. |
| **4 — Evaluation** | Seven-factor deterministic screening over a versioned rule set, with immutable snapshots. |
| **5 — Price + journal** | Ask / member / paid kept separate, comparability filtering, story chapters. |
| **6 — Legacy + hardening** | Fish Heaven, Keeper's Code, JSON export, reduced-motion and mute, non-colour status cues. |

### Deliberately not built yet

All of these are **P1 or P2** in the PRD's own priority legend, so none of them
block a first usable release:

- Audio and video memos, and transcription (FR-J02, FR-J03)
- External visual-search handoff (FR-I03)
- Geolocation capture — a favourite store is seeded, but there is no permission flow (FR-C03)
- Opt-in "finish your story later" reminder (FR-C08)
- User override on a verdict — modelled in the types, no UI (FR-E08)
- AI explanation of a verdict (FR-E09)
- Collection filtering (FR-R09) and size-over-time tracking (FR-T07)
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
│   ├── rarity/          PRD 5.3   — Personal Discovery Tier v0
│   └── pricing/         PRD 5.4   — comparability and price fit
├── data/          Dexie/IndexedDB schema, repositories, seed catalog, importer
├── theme/         Design tokens (PRD 7.3) and the three territories (7.2)
└── ui/            Screens and components — consume tokens only, never literals
```

The engines are pure functions of `(stored inputs, versioned config)`. That is
what makes principle **P5 — "Rules before AI"** enforceable: a verdict is
reproducible, inspectable, and stamped with the rule version that produced it.
`src/ui` contains no colour, radius or duration literal, which is what makes a
theme swap provably incapable of touching a record or a calculation.

### No backend

Everything — records and original media blobs — lives in IndexedDB on the
device. PRD 12.1 leaves the cloud/auth provider explicitly open, and PRD 2.2
requires the product to be worthwhile for one person with no community at all.
So the sync seam exists (`syncState` on media and encounters) but points
nowhere yet. Nothing leaves the device.

---

## Two things that need your input

**1. The species care data is unverified.** Seven species ship in
`src/data/seed/species-catalog.ts` covering the enclosure types in the PRD.
Every value is general hobbyist consensus typed in by hand. None of it has been
checked against a licensed care database, and no citation URL is attached
because none was consulted — each profile carries a source note saying exactly
that. PRD 12 names this as a top risk and PRD 12.1 leaves the source an open
decision. **Pick a source and re-verify every row before trusting a verdict.**

**2. Two files the PRD references were not provided.** `fish_inventory.xlsx`
(61 rows, six enclosure labels) and `IMG_5126.jpeg` (the jaguar encounter
photo). The importer is built to the documented column contract and tested
against a synthetic 61-row sheet — see [`docs/INVENTORY_IMPORT.md`](docs/INVENTORY_IMPORT.md).
Export the sheet to CSV and load it from Settings → Import inventory.

## One decision worth reviewing

PRD 5.2 lists a trigger for each verdict but no precedence between them, and
two triggers can fire at once — a proven hard conflict plus an unrelated
missing input. This build ranks a known conflict **above** *Not enough data*,
because reporting "Not enough data" when a fatal predation conflict is already
proven hides the more actionable fact. *Not enough data* still outranks
*Conditional* and *Suitable*, so no green verdict can survive a missing
required input — which is what FR-E05 and success measure 11.2 actually
require. The reasoning is written out in `src/engine/compatibility/engine.ts`.

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
