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
npm test             # 182 unit + integration tests
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

## Real data, seeded

The app opens on Ryan's actual system, not an empty shell:

- **All 61 inventory rows** across the six real enclosures, imported as opening
  balances from [`docs/fish_inventory.xlsx`](docs/fish_inventory.xlsx)
- **47 species profiles**, covering the fish that are actually in those tanks
- **The Panther**, with the real encounter photo, $100 asking / $75 member, and
  the story

Which makes the screening real. Ask the app where a 14″ jaguar cichlid could
live and it answers *Extreme risk* for every tank Ryan owns — naming the wolf
fish it would fight, the Geophagus it would kill, and the 125-gallon minimum a
75-gallon tank cannot meet. That is the product's whole thesis working: the
honest answer was always "nowhere", and the app says so without needing him to
buy anything to find out.

## About the species data

Per your decision, **Wikipedia is the placeholder source** until a licensed
care database is chosen (PRD 12.1). Every profile carries a real article URL.

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

## Running it as a live web app

A deploy workflow is committed at `.github/workflows/deploy.yml`. Push to
`main` and it tests, builds and publishes to GitHub Pages at
`https://leonidas47dario.github.io/Fish2tank/`.

**One blocker:** GitHub Pages on a **private** repository requires a paid
GitHub plan. This repo is currently private, so on the free plan the build
step will pass and the deploy step will fail. Three ways forward:

1. **Make the repo public** — Settings → General → Change visibility. Pages
   then works on the free plan. Everything in the app is local to the
   browser, so publishing the code exposes no personal data — though the
   inventory and the Panther photo are committed as seed data, so consider
   whether you want those public.
2. **Upgrade to GitHub Pro** (~$4/month) and keep it private.
3. **Host it elsewhere free** — the build is fully static. Netlify, Cloudflare
   Pages or Vercel will each deploy this repo from a private source on their
   free tier. Build command `npm run build`, publish directory `dist`, and
   leave `VITE_BASE` unset since those hosts serve from the root.

Enable Pages first under Settings → Pages → Source: **GitHub Actions**.

Because there is no backend, "deployed" means the app is installable from that
URL and then runs entirely on the device. Data never leaves the phone, and it
keeps working offline once installed.

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
