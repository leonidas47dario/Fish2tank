# 003 - Care-profile backfill for the 1,029 unprofiled species

**Status:** proposed
**Date:** 2026-08-29
**Touches:** PRD 12.1 ("Species-care sources", still open), FR-E05 / 11.2 (missing
inputs must return *Not enough data*, never *Suitable*).
**Introduces:** per-field care provenance, and a gate that verifies a claim
against the source text it was taken from.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "I noticed that most fish doesn't have profile, can you identify them and
> fill those out using wiki pedia? if it's not avail on wiki, I'd try to
> extract similar info from the stores who has those fish."

Two decisions given directly when the measurements came back:

- **Sourced only, accept the gap.** Ship a value only where a source states
  it. Do not derive minimum tank volume from adult size, and do not write
  hobbyist-consensus values per species. Most species will therefore still
  screen as *Not enough data*, and that is the accepted outcome.
- **All 1,029 in one campaign**, not a prioritised subset.

One assumption, stated and not corrected: a vendor listing that explicitly
states a figure counts as a source, labelled as trade evidence in the same way
`species-overrides.ts` already labels `viaVendor` names. It is weaker than a
taxonomic source and it is the only route that carries tank volume at all.

## The problem, stated accurately

1,076 species are in the catalog. **47 have a care profile. 1,029 do not** —
96%. Every one of the 1,029 carries the same mart field:

```
sourceLabel: "Discovered from vendor listings - no care profile yet"
```

That is not an accident, it is the design recorded in the README: the species
dimension is derived from what vendors sell, with the curated catalog as an
enrichment layer on top. The enrichment layer simply never grew past the real
inventory it was written for.

Three fields gate a compatibility verdict (`src/engine/compatibility/engine.ts`):
`minimumVolume`, `adultSize`, `aggression`. Miss any one and the factor returns
`insufficient-data`, which outranks every green verdict by design.

### What the sources can actually give

Measured over a deterministic 100-species sample of the gap, not estimated:

| | Species | Share |
|---|---:|---:|
| en.wikipedia article exists under the recorded name | 78 | 78% |
| No article under that name | 22 | 22% |
| Article states a tank volume | 3 | 3% |
| Article states a temperament word | 16 | 16% |

Regex found a body length in only 5%, but that number is an artefact of the
regex, not of Wikipedia. Read by hand, the *Balantiocheilos melanopterus*
article states all three of "a maximum length of 35 cm (14 in)", "generally
peaceful", and a temperature range — in three separate sentences, in prose,
under three different section headings. **The data is in prose, not in fields.**
That is why extraction is a language job and the fetch under it is not.

The distribution is uneven in a way that helps: popular aquarium fish have an
"In the aquarium" section carrying tank size and temperament, while obscure
species are FishBase-derived stubs carrying nothing. The fish a keeper is
likely to meet are the documented ones.

### What is unreachable

| Source | Result |
|---|---|
| fishbase.se | HTTP 503 |
| seriouslyfish.com | HTTP 503, via curl **and** WebFetch |
| wikidata.org | HTTP 503 |
| aquaticarts.com, predatoryfins.com | HTTP 503 / proxy interstitial |

DRW's Menlo Security isolation proxy, the same wall spec 002 hit. The care
databases that would answer this question properly cannot be reached from this
machine at all. Wikipedia, Wikimedia, and six of the eight vendor stores
respond normally. This is a constraint on the work, not a gap in it, and no
amount of code solves it here.

299 of 1,076 species carry a vendor `productUrl`. Shopify exposes
`<productUrl>.json`, whose `body_html` carries care prose — verified against
Imperial Tropicals (habitat, substrate and tankmate guidance) and AquaHuna
(an explicit "Suggested Water Temperature: 72 to 75 degrees F").

## Scope

### In

1. **`etl/fetch-species-text.ts`** — batched Wikipedia wikitext fetch with
   redirect resolution and 429 backoff, cached to disk, idempotent.
2. **`etl/fetch-vendor-text.ts`** — Shopify product JSON for the reachable
   hosts, cached the same way, with a recorded skip reason for the rest.
3. **Subagent extraction** over the local cache, writing quoted proposals.
4. **`etl/ingest-care-proposals.ts`** — the gate, which verifies every quote
   against the cached source text.
5. **Per-field provenance** through `dim_species`, the catalog mart, and the
   species page.

### Out

- **Deriving minimum volume from adult size.** Considered and rejected by the
  product owner in favour of sourced-only. Recorded under Alternatives.
- **Applying taxonomy corrections.** Subagents will surface misspellings and
  superseded combinations, as they did in spec 002. They are recorded, not
  applied. Same reasoning: backfilling care data must not quietly rewrite the
  species dimension.
- **Recovering the proxy-blocked sources.** Not solvable in code from here.
- **Changing the compatibility rules** to do more with partial data. The
  engine's treatment of missing inputs is correct and is not what this changes.

---

## Design

### 1. Fetch is deterministic and dumb

`fetch-species-text.ts` queries `action=query&prop=revisions&rvslots=main` with
50 titles per request, roughly 21 requests for the whole gap. Three details are
load-bearing:

- **Redirects are resolved and recorded.** The catalog says
  `Balantiocheilus melanopterus`; Wikipedia says `Balantiocheilos`. The
  redirect map is written alongside the text, because a resolved redirect is
  evidence of a possible taxonomy defect in our own data.
- **429 is expected, not exceptional.** Anonymous API use rate-limits hard;
  a burst of 60 single-title requests tripped it during probing. Serial
  batches, 1.5s apart, exponential backoff, and a loud failure after six
  attempts rather than a silent gap.
- **A missing article is recorded as a fact**, distinct from a failed fetch.
  Conflating those two is what made the first probe report "54 species have no
  article" when the real answer was "54 requests were rate-limited". Per the
  logging standard, the run summary reports them as separate counts.

Both fetchers skip species already cached, so a re-run makes zero network calls
and says so.

### 2. Extraction quotes its evidence

Subagents read the **cached text on disk**, not the network. Each returns one
JSONL row per species to `data/care/care-proposals.jsonl`:

```jsonc
{
  "species_id": "sp_bala_shark",
  "adult_size_in":  { "value": 14, "quote": "will grow to a maximum length of 35 cm (14 in)", "source": "wikipedia" },
  "aggression":     { "value": "peaceful", "quote": "These fish are generally peaceful and good companions to many other types of tropical fish", "source": "wikipedia" },
  "temp_c":         { "min": 22, "max": 28, "quote": "Water temperature should be kept between 22 and 28", "source": "wikipedia" },
  "min_volume_gal": null,
  "confidence": "high",
  "corrected_scientific_name": "Balantiocheilos melanopterus"
}
```

**Every value carries the verbatim sentence it came from. No quote, no value.**
`null` is the correct answer whenever the text does not say, and saying so is
not a failure — it is the outcome the product owner chose.

### 3. The gate verifies the quote, not the vibe

`etl/ingest-care-proposals.ts` is the boundary between a claim and shipped
data. For every field of every proposal:

1. **The quote must appear verbatim in the cached source text** for that
   species, compared on normalised whitespace. This is the mechanism that
   makes "sourced only" checkable rather than aspirational: a fabricated
   number cannot pass, because its sentence is not on disk.
2. **The figure must appear in its own quote.** A quote that does not contain
   the number attributed to it is a mis-citation, which is the failure mode a
   verbatim check alone would miss.
3. **Units must be sane:** adult size 0.2-120 in, volume 1-2000 gal,
   temperature 4-40 °C. Anything outside is rejected, not clamped.
4. **`aggression` must be one of the four `AggressionRating` values.**

Every rejection, every `confidence: "low"` row and every proposed taxonomy
correction goes to `data/care/care-review.jsonl` with the reason it landed
there. Per the logging standard each proposal logs intent *and* outcome, and a
run that accepts nothing says so loudly rather than reporting success over an
empty file.

### 4. Through the stack

Accepted rows are written to `src/data/seed/species-care.json` — committed, so
it is the audit record, but generated by the gate and never hand-edited.
`build-warehouse.ts` merges it **beneath** `SPECIES_CATALOG`, so a curated
profile always wins over a scraped one.

Per-field provenance is the modelling change. Today the mart carries one
`sourceLabel` and one `sourceUrl` for the whole species, which stops being true
the moment adult size comes from Wikipedia and tank volume comes from a store.
`dim_species` gains a `care_sources` column, the mart gains a `careSources` map
keyed by field, and `SpeciesDetail` renders a source link per row rather than
one line for the species.

---

## Acceptance criteria

1. Both fetchers are idempotent: a second consecutive run makes zero network
   calls and the summary says so.
2. Missing articles and failed fetches are reported as **separate** counts.
3. The gate is **demonstrated to reject**, by test: a fabricated quote absent
   from the cached text, a quote not containing its own figure, an
   out-of-range figure, and an invalid aggression value. A gate that cannot be
   shown to fail is not a gate.
4. `data/care/care-review.jsonl` lists every rejection with its reason, every
   low-confidence row, and every proposed taxonomy correction.
5. Every shipped care value has a source label and a URL. Asserted by a test
   over `catalog.json`, not by inspection.
6. No species loses care data it already had; the curated 47 are unchanged.
   Asserted by a before/after comparison.
7. Coverage is reported **per field** before and after — not as one total,
   which would hide that volume and aggression barely move.
8. `npm test`, `npm run typecheck`, `npm run build` and `npm run smoke` pass.

---

## Alternatives rejected

**Derive minimum volume from adult size by one versioned rule.** A documented
rule (length and width multiples of body length, converted to gallons) applied
uniformly is auditable, fits P5 "rules before AI", and would unlock real
verdicts for every species with a size. Rejected by the product owner in
favour of sourced-only. Recorded because it remains the strongest option if
the coverage this delivers proves too thin to be useful.

**Hobbyist-consensus values per species, labelled.** What the curated 47
already do, extended 22x by subagents. Rejected: it multiplies unsourced
per-species claims across the whole catalog, and it is the option most likely
to be confidently wrong in a way no gate can catch.

**Regex extraction, no LLM.** Cheapest, and it fails. Measured at 5% recall on
body length against text that plainly states it, because the phrasing varies
per article and the figures live in prose across several sections.

**Prioritise the 299 species with market listings.** A third of the work for
the highest-value third, and the only ones with a vendor route. Rejected in
favour of full coverage in one campaign.

---

## Risks

**A subagent extracts a real quote and reads it wrong.** The gate proves the
sentence exists and contains the figure; it cannot prove the sentence is about
the right animal, or that "reaches 35 cm" is standard length rather than total
length. `confidence` and the review file are the mitigation, and they are
partial. Accepted.

**Wikipedia states wild behaviour, not aquarium temperament.** "Aggressive"
in a taxonomy article may describe spawning behaviour in a river, not
tankmate risk in a 40-gallon. This is the weakest mapping in the design.
Mitigated by requiring the quote and by preferring the "In the aquarium"
section, not eliminated.

**Coverage lands thin.** On the sample, volume appears in 3% of articles and
temperament in 16%. The likely outcome is a catalog full of adult sizes where
most species still screen as *Not enough data*. That is the chosen trade and
the PR reports it per field rather than burying it in a total.

**Taxonomy defects found but not applied.** Same debt spec 002 took on
deliberately, and it lands in the same place.
