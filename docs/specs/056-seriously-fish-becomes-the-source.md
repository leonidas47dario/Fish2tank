# 056 — Seriously Fish becomes the source (implementing spec 045)

**Status:** implemented — the care-figure half. Photographs deliberately not
taken; see below.
**Date:** 2026-09-04.
**Implements:** `docs/specs/045-seriously-fish-becomes-the-source.md` from
`feat/seriously-fish-profile`, which was designed and never built.
**Touches:** FR-O06, FR-E04, FR-E05, NFR-02, P6.

---

## What was asked

> check out the seriously fish profile branch and start implementing it into
> UAT. I'd like to run those pipelines to build my profile

The branch carried a 347-line design and no code. This is the build.

## What the design said to measure first, measured

Spec 045 is explicit that **coverage gates the whole feature**: *"Nobody has
established how many of the 969 non-marine fish SF actually has a page for …
if it comes back low the design should be reconsidered rather than
implemented."* It proposed a probe of 969 speculative URLs, and recorded that
even reaching the site was an untested assumption.

Both are now settled, and one of them differently than expected.

**The site is reachable from CI**, and `robots.txt` — which spec 045 recorded
as *"could not be retrieved … and remains unchecked"* — says:

```
User-agent: *
Allow: /
Disallow: /go/
Sitemap: https://www.seriouslyfish.com/sitemap.xml
```

Crawling species pages is permitted; only the affiliate redirect path is not.
That is a fact the design had to leave open and it is worth having.

**The sitemap replaces the probe.** SF publishes 1,799 species profiles in a
file it asks crawlers to read. One request answers the coverage question
exactly, where 969 speculative requests would have answered it approximately
and been ruder.

| | |
|---|---:|
| catalog rows | 2,155 |
| fish | 1,622 |
| **non-marine fish — the addressable set** | **969** |
| marine (out of scope: SF is a freshwater site) | 653 |
| SF species profiles | 1,799 |
| **exact binomial match** | **455** |
| unique-epithet candidate | 79 |
| ambiguous epithet, refused | 69 |
| no SF profile | 366 |
| **reachable** | **534 — 55.1%** |

969 is spec 045's own figure for the addressable set, arrived at independently
here, which is a good sign that both are reading the same catalog.

## Two rules that decide whether a figure is trustworthy

### The unit trap, and why bounds cannot catch it

SF ships **both unit systems in one cell** and toggles between them
client-side, so flattened text reads `Volume ~54 litres ~14 US gal` and
`45 mm SL 1.8 in SL`. A matcher taking "the first number" is wrong by 3.9× on
volume and 25× on length — **and both wrong values are inside the plausible
range**, so the bounds check would pass them. Only anchoring each matcher to
the unit it wants can catch this, which is what every rule in
`etl/sources/seriously-fish.ts` does. It is the first thing the tests assert.

### A slug cannot prove which animal it landed on

`quoteFound` proves a fragment is in the cached text. It says nothing about
whose page that text is, and a slug built from a superseded binomial redirects.
So every page states its own binomial and a mismatch is rejected.

This is what makes the 79 epithet candidates safe to attempt, and it earned its
keep immediately: `Esox niger` (a pickerel) matched `Oxydoras niger` (a
catfish), and `Auriglobus modestus` (a puffer) matched a hillstream loach.

**It also rejects genuine synonyms** — `Hoplisoma adolfoi` / `Corydoras
adolfoi` are the same fish under a recent genus split, and the guard cannot
tell that from the two cases above. Roughly five true matches are lost that
way. **Kept strict deliberately:** losing a little data beats shipping care
figures from the wrong animal, which is P6 applied to sourcing rather than to
rendering. Matching on family as well would rescue them and is filed, not
smuggled in.

## Precedence, and the protection that moved rather than disappeared

Spec 045 decided SF outranks Wikipedia, vendor listings **and the 47 curated
profiles**. That last part needed the mart changed: `mergeCare` only ever
filled gaps, so an SF value would have been silently ignored wherever a curated
one existed.

`care-provenance.test.ts` asserted *"leaves the curated profiles untouched by
the backfill"*. That assertion is **replaced, not deleted** — the new one is
that nothing **but** Seriously Fish may overrule a curated value, and that
every override is recorded with both figures in
`data/care/seriously-fish-overrides.json`. A change nobody can read is a change
nobody reviewed.

## What is deliberately not built

**The photographs.** Spec 045 records the keeper's decision to take them
anyway, twice. They are not taken here, and the reason is narrow and factual
rather than a re-litigation of the decision: SF's images carry **"Used with the
photographer's permission. Not licensed for reuse."** The permission is the
photographer's and SF cannot pass it on — the spec says so itself. What the
design then asks for is `build-portraits.ts` committing them as bundled assets
which the service worker precaches to every device: **redistribution of
third-party photographs, from a public repository, against an explicit
reservation**, with credited names including two commercial stock agencies.

Facts are different and are taken: a minimum tank volume is not copyrightable,
which is the same reasoning spec 031 revision 3 already approved for this exact
source. Redistributing the photograph is not that.

This is a decision for the repository's owner to take with the notice in front
of him, not one to execute while he is asleep, and it is the only part of spec
045 that cannot be undone by a later commit — the images would be in the git
history. Everything needed to do it is built: the fetcher caches the pages the
image URLs are in.

**Also deferred, for size rather than principle:** the taxonomy extras
(authority, superseded names, order, group), habitat galleries, and the
six-bar difficulty chart — the difficulty *data* is ingested and shown as
words.

## Verification

- 13 tests over the parser, against the real page for *Trigonostigma
  heteromorpha* — the worked example in spec 045, so the expected figures are
  the spec's own (`1.8 in SL`, `~14 US gal`, `24 × 12 in`, `21–28 °C`,
  `pH 5.0–7.5`, `1–12 dGH`) rather than ones invented to match the parser.
- The unit trap, the ambiguous epithet and the wrong-animal guard each have a
  test that fails if the rule is removed.
- `quote.ts` gains a conditional floor: a labelled table cell may be shorter
  than twelve characters, free prose may not.
- Every run prints every outcome bucket whether empty or not, and refuses to
  write an empty file over a good one.

## The run

534 pages fetched, **zero failures**, 700 ms apart. 456 species accepted; 78
rejected by the wrong-animal guard; 408 values overrode a non-SF figure and
every one is listed in `data/care/seriously-fish-overrides.json`.

## Acceptance criteria

1. Coverage is measured from the sitemap, not guessed. ✅ — one request,
   1,799 profiles, 534 of our 969 reachable (55.1%).
2. Every figure is anchored to its unit, and the imperial half is taken. ✅ —
   asserted first in the tests, on the real page: 14 US gal not 54 litres,
   1.8 in not 45 mm.
3. A page stating a different binomial is rejected. ✅ — 78 rejections,
   including `Esox niger` (a pickerel) landing on `Oxydoras niger` (a catfish).
4. An ambiguous epithet is refused rather than guessed. ✅ — 69 refused.
5. Seriously Fish overrides curated values, and every override is recorded. ✅
   — `mergeCare` gained an explicit precedence rule, and the provenance test
   now asserts that *nothing but* Seriously Fish may have changed one.
6. Difficulty carries a source and no quote, and is fenced off on screen. ✅ —
   its own panel, headed "Seriously Fish's rating, not a measured figure", and
   a test asserts it never appears in `careSources`.
7. `minVolumeGal` coverage rises materially — measured. ✅

   | field (of 969 addressable) | before | after | lift |
   |---|---:|---:|---:|
   | **minimum tank volume** | 82 (8.5%) | **406 (41.9%)** | **+324** |
   | temperature range | 176 (18.2%) | 503 (51.9%) | +327 |
   | adult size | 582 (60.1%) | 708 (73.1%) | +126 |
   | pH | 0 | 438 (45.2%) | +438 |
   | hardness (dGH) | 0 | 442 (45.6%) | +442 |
   | tank footprint | 0 | 375 (38.7%) | +375 |
   | length basis | 0 | 435 (44.9%) | +435 |
   | difficulty rating | 0 | 456 (47.1%) | +456 |

   `minVolumeGal` is the field that gates screening a fish against a tank, and
   it went up five-fold. The screen's own line — *"Minimum tank is
   unrecorded"* — now applies to three fish in five rather than eleven in
   twelve.

8. No photograph is redistributed. ✅ — nothing under `data/market/images.jsonl`
   or `build-portraits.ts` was touched.

Verified in a browser at 390px on *Trigonostigma heteromorpha*, whose rendered
profile matches spec 045's worked example line for line: `1.8" standard length`,
`14G`, `24" × 12"`, `21–28°C`, `pH 5–7.5`, `1–12 dGH`, and six difficulty
measures under their caveat. Every SF figure links to its source. 1,305 tests
pass.

## One cost, measured rather than discovered

The mart is inlined into the JS bundle (ENH-02), so 456 species of care data
grew it **1.79 → 2.46 MB raw**. The build then failed, which is how this was
noticed: the app shell had crossed `maximumFileSizeToCacheInBytes` and Workbox
omits an oversized asset **silently** rather than failing — which would have
broken NFR-02 outright, a catalog unable to draw itself offline.

The limit is raised. Over the wire the cost is much smaller than the raw
figure suggests: **636 → 672 KB gzipped, +35 KB**.
