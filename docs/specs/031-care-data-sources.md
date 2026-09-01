# 031 — Where care data should actually come from

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

## Revision: freshwater first, which changes the order

> We would want to prioritize the fresh water fish fyi

Re-measured with that scope, and it changes the recommendation rather than
just narrowing it.

**The catalog holds 958 freshwater fish** (plus 144 plants, 102 inverts, 4
amphibians, 2 reptiles and 31 unclassified freshwater rows) out of 2,155.

### The existing data is already concentrated where it matters

Every figure roughly doubles when the marine long tail is set aside:

| Field | Whole catalog | **Freshwater fish** |
|---|---|---|
| `adultSizeIn` | 31.0% | **60.5%** |
| `aggression` | 9.2% | **18.7%** |
| `tempMinC` | 9.6% | **18.2%** |
| `minVolumeGal` | 4.2% | **8.4%** |
| `phMin` / `social` | 0% | **0%** |
| all four present | 3.4% | **6.8%** (65 species) |
| none of the four | 68.2% | **38.5%** (369 species) |

Still bad — 369 freshwater fish with nothing, pH at zero — but a far smaller
hole than the whole-catalog view suggests.

### SeriouslyFish is a freshwater site, and it shows

Against freshwater fish its coverage more than doubles:

| | Species | Share of 958 |
|---|---|---|
| Exact SeriouslyFish page | **450** | **47.0%** |
| Genus covered, that species not | 283 | 29.5% |
| No scientific name to match on | **0** | — |

Zero freshwater fish lack a binomial, so matching is clean rather than fuzzy.

**Projected coverage after a SeriouslyFish ingest of those 450:**

| Field | Now | After | Change |
|---|---|---|---|
| `adultSizeIn` | 60.5% | **74.2%** | +131 |
| `minVolumeGal` | 8.4% | **49.5%** | **+394 (≈6×)** |
| `aggression` | 18.7% | **52.3%** | +322 |
| `tempMinC` | 18.2% | **52.5%** | +329 |
| `phMin` | 0% | **47.0%** | +450, from nothing |

### So the order flips

Against the whole catalog FishBase was the obvious first move, on raw
coverage. **Against freshwater fish, SeriouslyFish goes first**, for one
reason: it is the only evaluated source that moves `minVolumeGal` and
`aggression` at all, and those are the two fields the compatibility engine
runs on and the two the curated 47 currently fake with hobbyist consensus. It
takes them from 8% and 19% to roughly half the freshwater catalog.

FishBase becomes the **second** pass — size, temperature and pH for the ~50%
SeriouslyFish does not reach — and its lack of husbandry fields matters much
less once SeriouslyFish has covered half of them.

### Sampled, not assumed

Three matched species that currently have **no** minimum volume were fetched
(3s apart, contactable UA). Extracted from *Parambassis ranga*:

```
Maximum Standard Length : 3.2″ (8cm)
Water Conditions        : Temperature 68-86°F (20-30°C), pH …
```

Both units are given, which removes a whole class of conversion error. The
minimum-volume heading is **`Aquarium Size`**, not `Maintenance` — worth
recording, because the obvious guess is wrong.

### The 283 genus-only matches are a trap, not an opportunity

It is tempting to fill a species from a congener's page. That is inventing a
number (P6) wearing a citation, and it is how the current placeholder problem
started. Either leave them at "not enough data", or — if they are ever used —
label them explicitly as genus-level and never let them read as measured for
that species.

## Recommended shape

*Revised by the freshwater scoping above.*

1. **SeriouslyFish first, scoped to the 958 freshwater fish.** 450 exact
   matches, and the only source that moves minimum volume and aggression —
   from 8% and 19% to about half the freshwater catalog, with pH going from
   nothing to 47%.
2. **FishBase second**, for size, temperature and pH across the ~50%
   SeriouslyFish does not reach, replacing Wikipedia as the size source.
3. **aqua-fish.net third**, to lift the husbandry percentage further; count
   its freshwater coverage before committing to it.
4. **Retire the `PLACEHOLDER` label per field as it is genuinely replaced**,
   so the 47 curated profiles stop carrying an unsourced min-volume behind a
   Wikipedia citation.
5. Keep one source per *field*, not per profile — `careSources` already works
   this way, and mixed provenance is the normal case here.

## Revision 2: stacking sources, and what each one is actually worth

> Not gonna be commercial, just personal use. Cant we scrape multiple sites?
> To improve coverage?

> **Superseded 2026-09-01.** Asked again, the answer became **"It's a maybe."**
> Everything below about *which* sources fill *which* gap still holds — it is
> measurement, not licensing. What no longer holds is the conclusion in the
> next paragraph. See open question 1.

**Personal, non-commercial use settles the FishBase question — CC-BY-NC is
fine.** And yes, stacking sources is the right instinct. The useful question is
not *can we* but *what does each additional one actually add*, because a source
that overlaps SeriouslyFish adds nothing but request volume.

### What is actually in the gap

Of the 958 freshwater fish, SeriouslyFish misses **508**. That gap is not
evenly spread — it is two clusters:

| Cluster | Species | Share of gap |
|---|---|---|
| **Catfish families** (Loricariidae 65, Callichthyidae 16, Mochokidae 9, Pimelodidae 8, …) | **137** | **27.0%** |
| **Cichlidae** (Crenicichla, Cichla, Geophagus, …) | **109** | **21.5%** |
| Both together | **246** | **48.4%** |
| Everything else — a long tail across 30+ families | 262 | 51.6% |

So **two specialist sites would address nearly half the remaining gap**, and
the rest is a genuine long tail where each additional source buys much less.
That is the shape of the answer: two more sources are worth a lot, six are
not.

### Permission, checked per host — and it is not uniform

| Source | `User-agent: *` | Signals | Verdict |
|---|---|---|---|
| **SeriouslyFish** | allow all but `/wp-admin/` | — | ✅ crawl politely |
| **FishBase** | allow; `Crawl-delay: 10`; deny `/cgi-bin/` | CC-BY-NC | ✅ now fine (non-commercial) |
| **aqua-fish.net** | allow content paths | — | ✅ crawl politely |
| **FishLore** | allow profiles; deny forum machinery | — | ✅ profile pages only |
| **PlanetCatfish** | `Allow: /` | `search=yes, ai-train=no, use=reference` — and **`ClaudeBot: Disallow: /`** | ⚠️ owner's call |
| **Cichlidae.com** | `Allow: /` | same, **`ClaudeBot: Disallow: /`** | ⚠️ owner's call |
| **The Aquarium Wiki** | **`Disallow: /`** | content is CC-BY-SA | ❌ no crawling |

Three findings worth stating plainly:

1. **The two sites that would close half the gap are exactly the two carrying
   a `ClaudeBot: Disallow` signal.** Their `*` rule allows a general crawler
   and their content signal says `use=reference`, which is what an ETL run by
   the keeper for personal reference is — and `ai-train=no`, which this is
   not. But they have named Anthropic's crawler specifically, and a scraper
   written by Claude against those two hosts deserves an explicit decision
   from the repo owner rather than being assumed in. **Not blocked — flagged.**
2. **The Aquarium Wiki disallows all crawlers** (`User-agent: * / Disallow:
   /`), despite its content being CC-BY-SA 3.0. A licence permitting reuse and
   a site permitting crawling are two different permissions, and this site
   grants the first and refuses the second. Off the table for automation.
3. **`aquariumwiki.com` is a parked domain for sale** and redirects to
   HugeDomains; the real wiki is `theaquariumwiki.com`. The robots.txt at the
   parked host describes the parking page, not the wiki. Recorded because it
   nearly produced a permission finding for the wrong site.

### Recommended stack, in order of marginal gain

1. **SeriouslyFish** — 450 of 958 (47.0%), and the only source that moves
   `minVolumeGal` and `aggression` at all.
2. **FishBase** — size, temperature and pH across essentially all remaining
   real fish. No husbandry fields, so it never touches min volume or
   aggression.
3. **PlanetCatfish** — up to 137 of the gap (27%), *pending the decision in
   finding 1*.
4. **A cichlid source** — up to 109 of the gap (21.5%), same caveat.
5. **aqua-fish.net / FishLore** — the long tail. Measure their freshwater
   coverage before building either; on this evidence each is worth far less
   than the four above and may be mostly overlap.

**Stop after the point where a source stops paying.** The 262-species tail
across 30+ families is where "not enough data" should simply remain the honest
answer.

### One rule that must survive multiple sources

`careSources` is already keyed **per field**, which is what makes stacking
safe: adult size can come from FishBase while minimum volume comes from
SeriouslyFish, and each cites its own origin. Two things follow, and both are
easy to get wrong under time pressure:

- **First source to supply a field wins, and later sources must not silently
  overwrite it.** Otherwise the last crawl to run decides the data.
- **Never merge two sources into one averaged number.** A midpoint between two
  cited values is a third value nobody published, which is inventing a number
  with two citations attached (P6). Where sources disagree materially, keep
  the higher-quality one and record the conflict.

## Open questions for the product owner

1. ~~Is the app ever going to be commercial?~~ **Answered twice, and the second
   answer is weaker than the first.** Revision 2 recorded *"Not gonna be
   commercial, just personal use"* and concluded FishBase was fine. Asked again
   on 2026-09-01, the answer was **"It's a maybe."**

   That is not the same answer, and it changes what may be built on FishBase.
   CC-BY-NC forbids commercial use outright, so "maybe" makes FishBase a
   foundation that might have to be torn out — and the expensive moment to
   discover that is after 2,000 species depend on it, because the migration is
   the whole catalog.

   **The ordering below is revised accordingly:** SeriouslyFish first rather
   than second, because it is © rather than NC-licensed and the take-facts-
   never-prose rule already covers it. FishBase, if used at all, must be
   confined to a slice whose provenance is recorded per field, so it can be
   removed without taking the rest with it. That is a real cost of "maybe" and
   is stated rather than absorbed.
2. **PlanetCatfish and Cichlidae.com carry a `ClaudeBot: Disallow` signal**
   while allowing general crawlers under `use=reference`. Do you want a
   crawler built for those two hosts? They are worth ~48% of the remaining
   gap. Your call, not mine to assume.
3. **Is 21% husbandry coverage worth a scraper**, or is the better move to
   accept "not enough data" more visibly and let keepers fill values in
   themselves?
3. **Should a keeper be able to override a sourced value** with their own
   measurement? Today nothing in the schema distinguishes "sourced" from
   "mine", and that question gets harder once real sources land.

## Requirements touched

PRD 12.1 (species-care sources), FR-E05 (not enough data), NFR-05 (every
computed result exposes its sources), NFR-12 (external sources behind
replaceable adapters), P6 (never invent a number).
