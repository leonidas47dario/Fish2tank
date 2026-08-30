# 018 — Where care data should actually come from

**Status: audit + source evaluation. No code.**

## What was asked

> Can you check fish profile? I think many are currently made up or
> incomplete. I found that Aqua-fish.net has a much better profile, I'd like
> you to find similar websites out there to scrape and complete the fish
> profiles.

## The audit: incomplete, yes. Made up, no — with one real caveat.

Measured against the built catalog mart (2,155 species), not estimated:

| Field | Species with a value | Coverage |
|---|---|---|
| `habitatNote` / `waterType` / `family` / `organismKind` | ~2,081–2,117 | **~97%** |
| `adultSizeIn` | 669 | **31.0%** |
| `aggression` | 198 | **9.2%** |
| `tempMinC` / `tempMaxC` | 207 | **9.6%** |
| `minVolumeGal` | 91 | **4.2%** |
| `phMin` / `phMax` | 0 | **0%** |
| `social` | 0 | **0%** |

- All four core care fields present: **73 species (3.4%)**
- None of the four: **1,470 species (68.2%)**

### Nothing is fabricated

`care-provenance.test.ts` asserts every backfilled care value carries a source
label *and* a URL, and it passes. The citations are **922 Wikipedia** and
**55 vendor listing**. There is no unsourced backfilled value in the mart.

### But the fields that matter most are unsourced on the curated 47

`species-catalog.ts` says so in its own header, and it is worth quoting rather
than paraphrasing:

> Wikipedia species articles are strong on taxonomy and adult size, and THIN
> on the things this engine actually screens on — minimum tank volume,
> aggression rating, and prey-size behaviour. **Those fields are conventional
> hobbyist consensus, not sourced from the linked article.**

Every one of those profiles carries a source labelled
`— PLACEHOLDER source`, and PRD 12.1 already committed to replacing them
"when a licensed care database is chosen".

So the honest verdict: **honestly labelled, not secretly invented — and
unsourced on exactly the fields the compatibility engine runs on.** The
suspicion behind the request is well founded.

### The root cause is structural, not sloppiness

The only bulk source is Wikipedia, which is a **taxonomy** source, not a
fishkeeping one. It reliably yields a binomial, a family and a maximum length;
it almost never yields minimum tank volume, temperament or water parameters.
That is precisely why those columns sit at 0–9% while taxonomy sits at 97%.

More Wikipedia will not fix this. A different *kind* of source will.

## Candidate sources, permission checked per host

Following the rule already in `MARKET_ETL.md`: permission is checked **per
host**, from that host's own `robots.txt`, not assumed from a brand.

| Source | robots.txt | Licence | Fields it can fill | Catalog coverage |
|---|---|---|---|---|
| **FishBase** (`www.fishbase.se`) | Allows; `Crawl-delay: 10`; disallows `/cgi-bin/`, `/tmp/` | **CC-BY-NC** | max length, temperature, pH, water type, depth | very high for fish; **no** min volume, **no** aggression |
| **SeriouslyFish** (`www.seriouslyfish.com`) | Allows everything but `/wp-admin/` | © all rights reserved | max standard length, **Maintenance (tank volume)**, **Water Conditions (temp/pH/hardness)**, **Behaviour and Compatibility** | **453 exact matches (21.0%)**, +295 genus-only |
| **aqua-fish.net** (`en.aqua-fish.net`) | Allows content paths; disallows `/process/`, `/modules/`, `/uploadify/`, `/uploader/`, `/fonts/` | © | pH range, temperature, tank size, origin | not yet counted |

Verified rather than assumed:

- SeriouslyFish species pages carry clean semantic headings — *Maximum
  Standard Length*, *Maintenance*, *Water Conditions*, *Behaviour and
  Compatibility* — which is exactly the missing set, and its sitemaps list
  **1,808 species pages**.
- `en.aqua-fish.net` pages do carry structured values (`Recommended pH range:
  6 - 8`), so the request's instinct about it is sound.
- **The ropensci FishBase API host was unreachable from the build environment
  (`http 000`)** while `www.fishbase.se` answered 200. Any plan that assumes
  that API works must verify it first rather than inherit this note.

## Three constraints that shape the design

### 1. Take facts, never prose

Numbers and measured ranges are not copyrightable; the article text around
them is. The repo already does the right thing here — `care:fetch` →
`care:plan` → `care:ingest` extracts *values* and verifies each one against
cached source text. **Reuse that pipeline.** Copying care write-ups into the
app would be a licensing problem no robots.txt cures.

### 2. FishBase is CC-BY-NC, and that is a real hook

Non-commercial only, with attribution. Fine for the app as it stands. It
becomes a genuine constraint the day this is monetised, and it would then have
to be renegotiated or removed rather than quietly kept. Recorded now because
that decision is much cheaper before 2,000 species depend on it.

### 3. No source gives minimum volume and aggression at scale

This is the finding that should shape expectations most, and PRD 12 named it
already: *"No single authoritative source covers minimum tank and aggression
consistently."*

FishBase does not carry either — they are husbandry judgements, not
measurements. SeriouslyFish carries both, for 21% of our catalog. So even a
perfect ingest leaves most species without them, and **"not enough data" must
remain the answer for those** (FR-E05). That is correct behaviour, not a gap
to be filled with a plausible-looking number — filling it is exactly how the
current placeholder problem started.

## Recommended shape

1. **FishBase first**, for the scientific fields at high coverage — max
   length, temperature, pH, water type. Biggest coverage win per unit of work,
   and it replaces Wikipedia as the taxonomy/size source with a better one.
2. **SeriouslyFish second**, for the husbandry fields FishBase cannot give —
   tank volume and temperament — accepting ~21% coverage and reporting it
   honestly in the UI.
3. **aqua-fish.net third**, as an additional husbandry source to raise that
   percentage; count its coverage before committing to it.
4. **Retire the `PLACEHOLDER` label per field as it is genuinely replaced**,
   so the 47 curated profiles stop carrying an unsourced min-volume behind a
   Wikipedia citation.
5. Keep one source per *field*, not per profile — `careSources` already works
   this way, and mixed provenance is the normal case here.

## Open questions for the product owner

1. **Is the app ever going to be commercial?** It decides whether FishBase is
   usable at all.
2. **Is 21% husbandry coverage worth a scraper**, or is the better move to
   accept "not enough data" more visibly and let keepers fill values in
   themselves?
3. **Should a keeper be able to override a sourced value** with their own
   measurement? Today nothing in the schema distinguishes "sourced" from
   "mine", and that question gets harder once real sources land.

## Requirements touched

PRD 12.1 (species-care sources), FR-E05 (not enough data), NFR-05 (every
computed result exposes its sources), NFR-12 (external sources behind
replaceable adapters), P6 (never invent a number).
