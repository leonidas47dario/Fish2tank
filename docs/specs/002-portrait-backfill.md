# 002 - Portrait backfill for the uncovered catalog

**Status:** proposed
**Date:** 2026-08-29
**Touches:** NFR-02 (offline resilience: a catalog that cannot draw itself offline has failed it). Catalog portraits are a post-PRD feature and still unnumbered; they get an ID in `docs/BACKLOG.md` when spec 001 lands.
**Introduces:** image provenance as a first-class field, and a subagent-proposes / script-verifies pattern for sourcing assets.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "I want you to identify all fish catalog that currently does not have a
> profile pic, and then spin up subagents to find good profile pics for them,
> and then update the assets and links."

Asked what a card should show when no free-licensed photo exists anywhere:

> "we can source them from store listings' pics, if that's not an option, then
> whatever is accurate from google"

Two follow-up decisions, given directly:

- Non-free photos are **labelled honestly** with their real source, not dressed
  up as licensed work and not left uncredited.
- Subagent proposals pass a **machine gate**, and anything the subagent was
  unsure about lands in a review list rather than shipping silently.

## The problem, stated accurately

1,076 species are in the catalog. 695 have a bundled portrait. **382 do not.**
(One further portrait file is an orphan whose species has left the catalog;
`build-portraits.ts` rebuilds the directory from scratch, so it disappears on
the next run without special handling.)

The gap is not bad luck. `etl/sources/wikimedia.ts` tries exactly one thing:
an English Wikipedia article titled with the scientific name, then its lead
image. Everything that article does not cover is uncovered. `data/market/images.jsonl`
holds 700 rows against 1,076 species, so the last `npm run images` run also
predates the catalog's growth.

Measured across all 382 (not sampled), classifying each by the first route that
returns an image:

| Route | Species | Share |
|---|---:|---:|
| `en.wikipedia` lead image | 8 | 2% |
| Commons full-text search, scientific name quoted | 138 | 36% |
| No Wikimedia image under that name | 234 | 61% |
| No scientific name recorded at all | 2 | 1% |

The 8 in row one are pure regression: the current code would find them today
if it were re-run. Row two is the single biggest win and needs only a second
query, though the hits need judging, because Commons returns distribution maps,
preserved museum specimens and confusable congeners alongside real portraits.

Cross-referencing the 236 species with no Wikimedia image against the store
listings already recorded in `market-index.json`:

| | Species |
|---|---:|
| Reachable store listing photo | 18 |
| Store listing exists, host unreachable | 42 |
| No store listing at all | 176 |

88 of the 382 carry at least one `productUrl`. 79 of those point at
`predatoryfins.com`, which is unreachable from this machine: DRW's Menlo
Security isolation proxy returns a 503 interstitial, and headless Chromium and
`WebFetch` both fail against it too. `imperialtropicals.com` and the three
smaller vendors respond normally, and because these are Shopify stores,
`<productUrl>.json` returns the product images directly. Verified against the
Albino Millennium Rainbowfish listing: a 2048x1365 photograph of exactly the
line-bred morph that Wikimedia will never carry.

**The residual 218 are not all unphotographed fish.** A meaningful share are
taxonomy defects in our own data. Confirmed by hand:

| Catalog says | Actually | Wikimedia has a photo |
|---|---|---|
| `Notropsis chrosomus` | *Notropis chrosomus* (misspelling) | yes |
| `Osteogaster aeneus` | *Corydoras aeneus* (2024 reclassification) | yes |

No script fixes those. Recognising that a name is a typo or a superseded
combination, and that the photo filed under the other name is the same animal,
is judgement work. That is what the subagents are for, and it is why they run
after the deterministic routes rather than instead of them.

## Scope

### In

1. **Two new resolvers** in the ETL: Commons file search, and vendor product
   JSON.
2. **Gap-fill mode** for `etl/build-images.ts`, so it merges instead of
   rewriting all 700 existing rows.
3. **`provenance` on the image record**, threaded through `dim_image`, the
   catalog mart and the UI credit block.
4. **Subagent sourcing** for the residual, writing proposals to a file.
5. **`etl/ingest-proposals.ts`**, the gate that turns proposals into shipped
   assets or into review items.
6. **UI credit rendering** per provenance, and correcting the Catalog footer,
   which currently states that portraits come from Wikimedia Commons.

### Out

- **Applying taxonomy corrections to the catalog.** Subagents will surface
  them and they will be recorded, but renaming species is a different change
  with different blast radius. Backfilling pictures must not quietly rewrite
  the species dimension.
- **Recovering the 42 predatoryfins listings.** Blocked at the corporate
  network layer. Not solvable in code from this machine.
- **A licensed care-data source.** Unrelated, still open from PRD 12.1.
- **Changing portrait dimensions, quality, or the precache strategy.** The
  480px / 0.68 trade in `build-portraits.ts` was measured and stands.

---

## Design

### 1. Stage 1: the deterministic routes

`etl/sources/wikimedia.ts` gains `searchCommonsPortrait(scientificName)`. It
queries the Commons search API in the File namespace with the scientific name
quoted, keeps `.jpg` and `.png` results, and reads licence and artist from
`extmetadata` exactly as the existing path does. Quoting matters: unquoted
search fuzzy-matches and suggested "panagia angularis" for *Pangio anguillaris*
in testing.

`etl/sources/vendor.ts` is new. Given a `productUrl`, it fetches
`<productUrl>.json`, takes `product.images[0]`, and returns a `SpeciesImage`
with `provenance: 'vendor'`, no licence, `artist` set to the store's display
name and `attributionUrl` set to the product page. It attempts only the hosts
known to respond, and records a skip reason for the rest rather than retrying
into a proxy wall.

`etl/build-images.ts` changes in two ways. It reads the existing
`images.jsonl` and attempts **only species with no row**, which makes the step
idempotent and cheap to re-run. And it tries the three routes in order:
Wikipedia, then Commons search, then vendor. Order encodes the preference: a
free licence beats borrowed art whenever both exist.

Expected yield: 164 species, no LLM involved.

### 2. Stage 2: subagents on the residual

Roughly 218 species, in batches of about 12, dispatched in waves of six agents
so proposal quality can be judged before the whole set is spent.

Each agent receives, per species: `speciesId`, common name, scientific name,
family, and any store URLs on record. It must work the routes in this order:

1. **Check the name.** Look for a misspelling, a synonym, or a superseded
   genus. If found, re-check Wikimedia under the corrected name first.
2. **Store listing**, if one exists and responds.
3. **Open web**, for anything still uncovered.

It returns one JSONL row per species to `data/market/portrait-proposals.jsonl`:

```jsonc
{
  "species_id": "sp_notropsis_chrosomus",
  "url": "https://upload.wikimedia.org/.../Notropis_chrosomus_-_Wilhelma_01.jpg",
  "provenance": "wikimedia",          // wikimedia | vendor | web
  "license": "CC BY-SA 4.0",          // null when not stateable
  "artist": "H. Zell",
  "attribution_url": "https://commons.wikimedia.org/wiki/File:...",
  "confidence": "high",               // high | medium | low
  "reason": "Catalog spelling is a typo for Notropis chrosomus; file is captioned with that binomial.",
  "corrected_scientific_name": "Notropis chrosomus"
}
```

Three rules bind the agents:

- **`url` must be a direct image URL**, not a page that contains one.
- **Return `"url": null` rather than guess.** A blank card is a correct
  outcome. The catalog already returns "Not enough data" instead of inventing
  care values, and inventing a picture is the same error with a prettier face.
- **`reason` must say why this image is that species.** "Looks like a pleco"
  is not a reason. It is the field a human reads when auditing a low-confidence
  call, so it carries the evidence.

### 3. Stage 3: the gate

`etl/ingest-proposals.ts` is the boundary between a claim and a shipped byte.
For every proposal it:

1. Downloads the URL from **this** machine. A URL a subagent could read but we
   cannot fetch is worthless, and this is where the proxy-blocked hosts fail
   fast and visibly.
2. Asserts the response is an image by content type, and decodes far enough to
   read real dimensions.
3. Rejects anything under 400px on the long edge, since it will look worse than
   the silhouette it replaces at a 480px target.
4. Rejects duplicates: two species resolving to the same image URL means at
   least one is wrong.

Accepted rows are appended to `images.jsonl`. Everything else, plus every
`confidence: "low"` row and every `corrected_scientific_name`, is written to
`data/market/portrait-review.jsonl` with the reason it landed there.

Per the logging standard: each proposal logs its intent and its **outcome**,
the check that rejected it, and the host it came from. A run that accepts
nothing must say so loudly rather than report success over an empty file.

### 4. Provenance through the stack

`provenance: 'wikimedia' | 'vendor' | 'web'` is added to `SpeciesImage`, the
`images.jsonl` row, `dim_image`, and `CatalogPortrait`. `license` becomes
nullable, because vendor and web photos have none.

That forces one deliberate reversal. `etl/build-portraits.ts` currently reads:

```ts
if (!row.license) continue; // never bundle what we cannot attribute
```

Under this spec the test becomes **sourced**, not **licensed**: require
`provenance` and `attributionUrl` instead. The comment gets rewritten to state
the new rule and the decision behind it, because a comment that contradicts its
code is worse than no comment.

`etl/sources/wikimedia.ts` opens with a block arguing against store photos as
species portraits, on three grounds: vendor copyright, links rotting on
delisting, and consuming someone else's bandwidth. Two of those three are
answered by the existing architecture rather than by argument, and the note
gets amended to say so honestly:

- **Delisting** does not break the image. Bytes are downloaded once and
  committed; only the attribution link can rot.
- **Bandwidth** is one fetch at build time, not one per page load.
- **Copyright** is not answered. It is a decision the product owner made
  knowingly for a personal field guide, and the spec records it as such rather
  than pretending the objection evaporated.

### 5. UI

`SpeciesDetail.tsx` renders the credit block by provenance:

| Provenance | Renders |
|---|---|
| `wikimedia` | `Per Harald Olsen, CC BY 3.0 — source` (unchanged) |
| `vendor` | `Photo: Imperial Tropicals (product listing) — source` |
| `web` | `Photo: <site name> — source` |

The Catalog footer currently reads "Portraits from Wikimedia Commons under
their stated licences". That stops being true and is reworded to describe the
mixed sourcing.

---

## Acceptance criteria

1. `npm run images` is idempotent: a second consecutive run makes zero network
   calls for species that already have a row, and this is demonstrated by the
   run summary.
2. Stage 1 resolves at least 150 of the 382 (measured routes predict 164).
   Shortfall is reported per route, not hidden in a total.
3. Every shipped portrait has a non-null `provenance` and `attributionUrl`.
   Asserted by a test over `catalog.json`, not by inspection.
4. `ingest-proposals.ts` is **demonstrated to reject**: a proposal with a dead
   URL, one with a non-image content type, one under 400px, and one duplicating
   another species' image. A gate that cannot be shown to fail is not a gate.
5. `data/market/portrait-review.jsonl` exists and lists every rejected and
   low-confidence proposal with its reason, and every proposed taxonomy
   correction.
6. No species that had a portrait before loses one. Asserted by a before/after
   count, not assumed.
7. The Catalog footer no longer claims all portraits come from Wikimedia, and
   `SpeciesDetail` renders the correct credit form for one species of each
   provenance.
8. `npm test`, `npm run typecheck`, `npm run build` and `npm run smoke` pass.
9. Bundle growth is reported in the PR. Estimated 9.6MB to roughly 15MB at
   ~14KB per portrait, which stays well inside the reasoning already recorded
   in `build-portraits.ts`.

---

## Alternatives rejected

**All-subagent.** Split all 382 across agents and let each do everything.
Simpler to describe, but it spends tokens re-deriving what a 40-line script
does deterministically, and an LLM transcribing `extmetadata` by hand is
strictly worse at it than reading the field. Rejected on cost and consistency.

**Script only, accept the gap.** Add the Commons route, reach roughly 860 of
1,076, leave the rest blank. Cheapest and licence-clean, but it declines the
thing that was actually asked for.

**Genus-level stand-ins.** Use a congener's photo, captioned as
representative. Tested: it puts a generic kuhli loach on *Pangio anguillaris*
and *Potamotrygon henlei* on *P. boesemani*. For a field guide whose purpose is
identification, a confidently wrong picture is worse than an empty frame.

**Ship non-free photos without visible credit.** Rejected by the product owner
in favour of honest labelling. It would also have removed the only mechanism
for auditing which cards rest on borrowed art.

---

## Risks

**A subagent ships a confidently wrong fish.** The most likely failure, and
the reason the gate exists. Mitigation is partial, not total: the gate catches
technical failures and duplicates, and `confidence` plus `reason` routes the
doubtful cases to review. It cannot catch a well-argued mistake about a photo
of the wrong *Hypancistrus*. Accepted, with the review file as the audit trail.

**Copyright.** Vendor and web photos are used without permission. Honest
attribution reduces this to a takedown request rather than passing-off, and the
provenance field makes every affected card findable in one query. It does not
eliminate the exposure, and this spec does not claim otherwise.

**Taxonomy corrections found but not applied.** Recording that
`Notropsis chrosomus` is misspelled and then leaving it misspelled is a known,
deliberate debt. It goes to `docs/BACKLOG.md` rather than being silently
dropped once spec 001 lands.

**Precache growth.** 382 more portraits enlarge the install every user pays
for. 15MB against a 1GB GitHub Pages limit is comfortable, but the number is
reported rather than assumed, and it is the reason nothing here touches the
480px decision.
