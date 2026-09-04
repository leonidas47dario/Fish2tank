# 045 - Seriously Fish becomes the source

**Status:** designed, not implemented
**Date:** 2026-09-04
**Touches:** FR-O06 (profiles complete progressively; an incomplete one stays usable but returns *Not enough data*), FR-E04 (every input and source behind a verdict is inspectable), FR-E05 (*Not enough data* rather than safety inferred from missing facts), NFR-02 (the catalog draws itself offline), spec 003 (care-profile backfill, whose pipeline this extends), spec 040 (one block of facts about this fish).
**Introduces:** `seriouslyfish` as a third source kind, the *length basis* distinction (SL vs TL), five new care fields, and the first ETL step that cannot run on Ryan's machine.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "Take a look at https://www.seriouslyfish.com, I'd like to redesign our fish
> profile and base it off this site as the source of truth for names, careguide
> etc."

Then, on the photographs, twice and unprompted:

> "(A), and I need those photos, we'll download them or link them."
> "(A) and we will get the photos regardless."

Five decisions taken directly during design, each recorded below at the point it
binds.

## The problem, stated accurately

### The care fields are close to empty where it matters

Measured on `main` at d0232d1. The catalog holds 2,155 entries: 868 marine,
1,287 not. Of the non-marine entries, 969 are fish, 171 plants, 107
invertebrates, 5 amphibians, 2 reptiles, 33 unclassified.

Seriously Fish is a freshwater site, so those **969 non-marine fish are the
entire addressable set**. Within them:

| Field | Missing | Share |
|---|---:|---:|
| Minimum tank volume | 887 | 91.5% |
| Temperature range | 793 | 81.8% |
| Temperament | 789 | 81.4% |
| Adult size | 387 | 39.9% |
| Portrait | 170 | 17.5% |

`minVolumeGal` is the field that gates screening a fish against a tank. At 8.5%
coverage the screen cannot answer for eleven fish in twelve, and
`SpeciesDetail` already says so out loud: *"Minimum tank is unrecorded."*

**SF publishes a minimum tank footprint and a volume on every profile.** For
*Trigonostigma heteromorpha*: base `60 x 30 cm / 24 x 12 in`, volume
`~54 litres / ~14 US gal`. This is the single strongest argument for the whole
exercise, and it is precisely what aquadiction could not give us when it was
assessed on 2026-09-03 (see `aquadiction-species-source` in project memory).

### What a profile carries that we do not

Read from the live page for *T. heteromorpha*:

- **Names.** Accepted binomial, authority and year (`Duncker, 1904`), the
  superseded name (`Formerly Rasbora heteromorpha`), family, order and group.
- **Quick facts.** Length as standard length, tank base dimensions, volume,
  temperature, pH, hardness in dGH.
- **Difficulty.** Six measures - space, water, temp, temperament, social,
  compatibility - each on a six-point scale with a word for the value.
- **Twelve prose sections**, including in-situ habitat description and a
  references list of primary literature.
- **Profile completeness**, e.g. "22 of 24, 92% complete", naming the fields
  the profile still lacks.

### The length field already holds two different measurements

Of the 642 sourced size quotes in `species-care.json`:

| Basis stated in the quote | Count |
|---|---:|
| Total length | 82 |
| Standard length | 156 |
| Not stated | 404 |

`adultSizeIn` is therefore a single number meaning nose-to-tail-tip for some
species and nose-to-tail-base for others, with no way to tell which. SF is
consistently standard length. Adding it improves the SF subset and makes the
field as a whole *more* misleading, because the inconsistency becomes larger
while staying invisible.

Harlequin is the live case: we hold 2.0 in, SF holds 1.8 in SL, and neither is
wrong.

### The photographs we lack are not photographs SF has

1,166 catalog entries have no portrait. **866 of them, 74%, are marine.** The
top genera in the gap are Chaetodon, Cirrhilabrus, Pseudanthias, Centropyge,
Acanthurus, Halichoeres, Acropora and Amphiprion. Butterflyfish, fairy wrasses,
anthias, angels, tangs, wrasses, SPS coral and clownfish.

Seriously Fish has never written about any of them. Inside the freshwater set
it could serve, 170 fish lack a portrait.

### Nothing that could fix the marine gap is reachable

Tested from `chvld-rliao1` on 2026-09-03 and re-confirmed 2026-09-04:

| Host | Result |
|---|---|
| `seriouslyfish.com` | 503, Palo Alto / Menlo interstitial |
| `api.inaturalist.org` | 503 |
| `www.inaturalist.org` | 503 |
| `api.gbif.org` | 503 |
| `commons.wikimedia.org` | 301, reachable |

Wikimedia remains the only image source reachable from the work machine. The
marine portrait gap needs a marine-capable licensed source and is **out of
scope for this spec**.

## The licensing position, recorded

Stated plainly because a spec is the audit trail.

- SF publishes **no terms of use, no privacy page and no copyright page**;
  `/terms`, `/about` and `/privacy` all 404. There is no equivalent of
  aquadiction's explicit "you may not scrape or use this for AI" clause.
  `robots.txt` could not be retrieved through the proxy available during
  design and remains unchecked. **Absence of terms is not a grant of
  permission**, and SF is UK-based, where a substantial extraction of a
  structured database attracts protection beyond copyright.
- Their own contributor standard matches ours: *"Every contribution carries a
  source"*, paste a DOI, and where a fact comes from prose already on the page,
  *"Quote the sentence."*
- Images carry: **"Used with the photographer's permission. Not licensed for
  reuse."** The permission is the photographer's to give and SF cannot pass it
  on. Credited names include Hippocampus-Bildarchiv and JJPhoto, both
  commercial aquarium stock agencies.
- Their prose carries affiliate links to filters and heaters.

FR-P06 is written about pricing rather than care data, but its condition is the
one in play here: *"Automate selected public pricing research only after source
licensing and normalization are approved."* The licensing on this source is not
approved by its owner. It is approved by Ryan, which is a different thing, and
the distinction is the reason this section exists.

**Decision (Ryan, twice, after the above was put in front of him): take the
photographs anyway.** Recorded here rather than argued. The design carries the
photographer's name and a link to the source profile on every image, and it is
worth being clear that `build-portraits.ts` commits portraits as bundled
assets which the service worker precaches to every device, so this is
redistribution inside a public build and not a local copy.

**Decision: prose is not copied.** The care guide stays on their site behind a
"Read the full profile on Seriously Fish" link. We take figures, each carrying
the verbatim sentence it came from, and we take the six difficulty measures as
an attributed judgement.

## Design

### 1. Sourcing and precedence

`SourceKind` in `etl/care/verify.ts` gains `'seriouslyfish'`, which flows into
the allowed-source assertion in `care-provenance.test.ts` and the
`SOURCE_LABEL` map in `SpeciesDetail.tsx`.

Precedence, highest first: **Seriously Fish, then Wikipedia, then vendor.**

**Decision: SF outranks the 47 curated profiles as well.** This was asked
explicitly, because the alternative had looked more attractive than it was: all
47 hand-written profiles are already complete on all four care fields, so
"SF fills the gaps in your curated profiles" would have been a no-op. What SF
can do to the 47 is disagree, and Ryan chose to let it win.

Consequences, all of which must be built:

- The assertion `leaves the curated profiles untouched by the backfill` in
  `care-provenance.test.ts` is **replaced**, not deleted. The new assertion is
  that every curated value SF overrode is recorded with both figures.
- The superseded curated value is **kept in the record** alongside SF's, so the
  change is reversible and diffable rather than lost.
- The ingest prints every override with both figures and the delta, and the
  Actions run surfaces that list in the PR body. A change to a hand-written
  value must be readable before it lands, not discovered afterwards.
- None of the 47 are marine, and roughly nine have no SF page at all:
  Flowerhorn and King Kong Parrot are hybrids with no binomial, *Heros* sp. and
  *Geophagus* sp. are undescribed, and the two shrimp, the crab, the snail and
  the clawed frog fall outside what SF writes about.

### 2. Schema

New fields on the catalog species record:

| Field | Type | Note |
|---|---|---|
| `lengthBasis` | `'SL' \| 'TL' \| 'unstated'` | Backfilled for the 238 existing quotes that state one |
| `phMin`, `phMax` | number | |
| `hardnessMinDgh`, `hardnessMaxDgh` | number | |
| `tankBaseLengthIn`, `tankBaseWidthIn` | number | The footprint, distinct from volume |
| `difficulty` | six named measures, each 1-6 plus a word | Attributed to SF, never quote-gated |
| `authority` | string | `Duncker, 1904` |
| `supersededNames` | string[] | `Rasbora heteromorpha` |
| `order`, `group` | string | Taxonomy above family |

**Decision: `lengthBasis` is carried and shown.** The profile prints
"standard length" under the figure when known. A compatibility engine that
sizes deep-bodied fish by mixing SL and TL is quietly wrong for every one of
them.

### 3. The quote gate needs three repairs

The existing gate is the mechanism that makes "sourced only" checkable, and SF
breaks it in three specific places.

1. **pH and hardness have no unit token.** `NUMBER_UNIT` in `etl/care/quote.ts`
   finds a figure by the unit attached to it, and `5.0-7.5` has none. Both need
   their own matcher and their own `PLAUSIBLE` bounds. Without this every pH
   value is discarded as unsupported, silently.
2. **The evidence is a table cell, not a sentence.** SF states pH, hardness and
   temperature in a structured facts table, so the stored quote is `pH 5.0-7.5`
   rather than prose. That is *stronger* evidence than a sentence, but
   `quoteFound` rejects any quote under 12 characters as "too short to be
   evidence of anything", which would throw away correct table values. The
   length floor becomes conditional on the quote's shape.
3. **The difficulty measures cannot pass the gate at all** and must not pretend
   to. They are SF's editorial rating, with no sentence behind them. They are
   stored with `source: 'seriouslyfish'` and no quote, and the provenance test
   is extended to allow exactly that for exactly this field group and nothing
   else.

### 4. The screen

**Decision: collection first.** Current order on `main` is hero, *What we know*,
*Card art*, market, *Your fish*, *Picture credit*. The new order is:

1. **Hero.** Scientific name as the heading and common name beneath it, as
   today, plus authority and family, the superseded name, and the existing tier,
   scarcity and Dream List row.
2. **Card art**, unchanged.
3. **Your fish**, unchanged.
4. **What we know**, rebuilt as a six-value grid: length with its basis, minimum
   tank, footprint, temperature, pH, hardness. Each sourced figure carries a
   marker that opens the sentence it came from, replacing the current
   parenthesised source label repeated per row.
5. **Difficulty**, six bars, visually fenced from the sourced figures and
   labelled "Seriously Fish's rating, not a measured figure".
6. **Reference photo** with the photographer's name and a link to the profile.
7. **Read the full profile on Seriously Fish.**
8. **Market**, unchanged.

The existing empty state is kept as written. `SpeciesDetail` already says *"No
care profile for this one ... Nothing here is guessed from the family, so a
screening against your tanks will say it cannot answer rather than invent one"*,
and that is the correct rendering for the 868 marine species this feature will
never touch. A section renders only when a value backs it.

### 5. Photographs

**Decision: gap fill plus upgrade.** SF's lead image is preferred over Wikimedia
for every non-marine fish SF covers, not only the 170 with no portrait at all.
Many of the 989 existing portraits are preserved specimens or poor tank shots;
SF's are photographs of live fish.

Mechanically this is a new provenance value, not a new pipeline. SF images
become rows in `data/market/images.jsonl` with `provenance: 'seriouslyfish'`,
the photographer's name in `artist`, and the profile URL in `attributionUrl`.
`build-portraits.ts` downloads and downscales to 480px exactly as it does now.

Habitat photographs are **deferred**. SF profiles carry up to seven images
including in-situ habitat shots, which nothing else we have does, but a gallery
is a second UI change and roughly +11 MB of precache. Revisit once the profile
layout has been used.

### 6. Where the fetch runs

`seriouslyfish.com` is blocked from `chvld-rliao1`, so **the fetch moves to
GitHub Actions**, which has no Menlo filter. A `workflow_dispatch` job runs
fetch, extract and verify, then opens a PR carrying the `species-care.json`
diff and the override list in its body.

Nothing needs to be re-verifiable locally for this to hold: `quote.test.ts` and
`verify.test.ts` use inline text, and `care-provenance.test.ts` asserts over the
built mart. **No test reads the text cache**, so the cache stays gitignored
exactly as spec 003 left it.

Politeness and idempotency come from `etl/sources/http.ts`, the shared client
the vendor care fetch was routed through in ba924ba. One cache file per species
under `data/care/text/<id>.seriouslyfish.txt`; a species with a cache file is
never fetched twice. Slugs are derivable, `genus-species` lowercased, so no
search step is needed.

## What has to be measured before any of this is built

**Coverage is unknown.** Nobody has established how many of the 969 non-marine
fish SF actually has a page for. The whole feature is worth roughly that
number, and if it comes back low the design should be reconsidered rather than
implemented. Step one is a probe that reports the hit rate and writes the
matched slugs, and it is cheap: 969 requests against derivable URLs.

**That the Actions runner can reach seriouslyfish.com is an assumption**, not a
tested fact. It is near-certain and it is also load-bearing for every other
step, so the probe proves it first.

## How this can go wrong

- **Both unit systems are in the same cell.** SF ships metric and imperial
  together and toggles between them client-side, so the length cell reads
  `45 mm SL 1.8 in SL` and the volume cell `~54 litres ~14 US gal` once the
  markup is flattened to text. A naive matcher finds two figures in one field
  and may take either. The extractor must split the pair deliberately and store
  the half it used, and the plausibility bounds are the backstop, not the
  check.
- **The wrong animal.** `quoteFound` proves a sentence exists in the cached
  text. It cannot prove the page is about the species we asked for. A slug
  built from a stale binomial can land on a redirect to a different fish, so
  the fetcher records the binomial the page states and the ingest rejects a
  mismatch rather than trusting the slug.
- **A curated value lost quietly.** This is the sharpest risk the design
  accepts by choice. The mitigation is entirely in the override list being read
  before the PR merges.
- **`profile-completeness` is a trap.** SF's own "22 of 24" counter tempts a
  reading of the page as complete or not. It counts SF's fields, not ours, and
  must not be stored as a quality signal for our record.

## Verification

- `quote.test.ts` gains cases for unitless pH, dGH, and short table-cell
  quotes, including the negative cases: a pH figure absent from its quote, and
  a table cell too short to be evidence under the new conditional floor.
- `verify.test.ts` gains a rejection path per new field, because a gate nobody
  has watched fail is not a gate.
- `care-provenance.test.ts` allows `seriouslyfish` as a source, asserts every
  difficulty rating carries a source and no quote, asserts every other new
  field carries both, and replaces the curated-untouched assertion with the
  override-recorded one.
- A test asserting `lengthBasis` is present wherever a size quote states one,
  over the built mart.
- The ETL run is judged on its own log: every species lands in exactly one
  outcome bucket, buckets print whether empty or not, and a run that fetched
  nothing says so rather than reporting success.
- The screen has no component tests, because none exist in this repo. The rows
  builder moves into a pure function under `src/domain/` and is tested there;
  the screen keeps markup only. See `verifying-ui-changes-in-the-browser` in
  project memory for the browser check.

## Out of scope

- The marine portrait gap, 866 species, which needs a source nobody has found.
- Mirroring SF prose, refused on licensing.
- Habitat photograph galleries, deferred.
- Contributing our own data back to SF, which their `/contribute` flow invites
  and which is a better answer to the licensing question than anything in this
  spec.
