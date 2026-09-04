# 058 — A photograph with a licence behind it

## What was asked

Offered a choice of what to build next, the answer was:

> Seriously Fish photographs

Every Seriously Fish species page carries a photograph, and the care ingest
(spec 056) already fetches and caches those pages. Taking the pictures while we
are there looks like the cheapest portrait win available.

## Why the literal request is not what gets built

Each Seriously Fish image is captioned:

> Used with the photographer's permission. Not licensed for reuse.

That sentence is the whole problem, and it is a different problem from the one
spec 002 already decided. Spec 002 loosened the portrait bar from *licensed* to
*sourced* — provenance and an attribution URL, no licence required — precisely
so vendor listing photos and "whatever is accurate from google" could ship,
labelled honestly. That decision covers photographs whose licence is **not
stated**. It does not cover photographs whose licence **is** stated and says no.

Three further facts, none of which the loosened bar answers:

- The rights are not Seriously Fish's to grant onward, and this is measured
  rather than assumed. Of the 534 species pages already cached by spec 056's
  care ingest, **511 carry the "Not licensed for reuse" caption verbatim**. The
  credit lines name individual photographers — and two **commercial aquarium
  image agencies** between them account for a majority of the pages:
  **JJPhoto on 205 pages, Hippocampus-Bildarchiv on 106**. Taking the images
  would not be borrowing a hobbyist's snapshots; it would be copying two
  agencies' catalogues.
- Spec 031 revision 3 settled that this project assumes commercial use. That
  was the answer that removed FishBase; it applies here with more force,
  because FishBase's problem was a permissive-but-NC licence and this is an
  explicit prohibition.
- The repository is public and git history is not erasable in practice. A
  mistake here is not revertable the way a bad commit is.

So the ask is honoured by its **intent** — better photographs of the 1,166
species that have none — and refused in its **letter**. What follows is the
measurement that found a source which does not need any of the above waved
through.

## The problem, stated accurately

Measured against `src/data/seed/marts/catalog.json` as promoted to production
on 2026-09-04:

| | Species | Have a portrait | Gap |
|---|---:|---:|---:|
| Whole catalog | 2,155 | 989 (45.9%) | **1,166** |
| Marine | 868 | — | 866 |
| Freshwater | 1,241 | — | 259 |
| Brackish / unclassified | 46 | — | 41 |

1,155 of the 1,166 carry a clean binomial, so they are addressable by a
taxon-name lookup.

The marine 866 is the part everything so far has failed on. Wikimedia's
coverage of reef fish is thin, and the vendor route only reaches species a
tracked shop actually lists.

## What was measured

iNaturalist's public API, queried from this environment on 2026-09-04. Two
probes over the **same** stratified sample of 65 gap species (40 marine, 25
freshwater), sampled evenly across the gap list, 1.1s between calls per their
rate-limit guidance. Both probes accept a taxon only on an **exact binomial
match**, which is the same wrong-animal guard spec 056's ingest needed.

Only `cc0`, `cc-by` and `cc-by-sa` are counted as usable. `cc-by-nc` is
excluded deliberately: it is exactly the licence that removed FishBase once
"assume commercial" was settled, and it must not come back in through a
different door.

**Probe 1 — the taxon's `default_photo`:**

| | Checked | Usable licence |
|---|---:|---:|
| All | 65 | 10 (15.4%) |
| Marine | 40 | 6 |
| Freshwater | 25 | 4 |

**Probe 2 — does *any* usable-licence photo exist for the species:**

| | Checked | Usable licence |
|---|---:|---:|
| All | 65 | **39 (60.0%)** |
| Marine | 40 | **29 (72.5%)** |
| Freshwater | 25 | 10 (40.0%) |

Probe 1 was a **4× underestimate**, and the reason matters: `default_photo` is
one photo per taxon, chosen by the iNat community for how well it shows the
animal, not for its licence. Filtering the observation set instead is what
finds the picture that is actually usable. Had probe 1 been reported as the
answer — 15%, "not worth building" — that conclusion would have been wrong, and
wrong in the direction of doing nothing.

Six of the hits, to show they are not marginal: *Pomacentrus coelestis* (323
usable-licence observations), *Centropyge bicolor* (230, CC0), *Chrysiptera
taupou* (152), *Microcanthus strigatus* (85), *Acropora caroliniana* (2),
*Zebrasoma rostratum* (2).

Extrapolated to the 1,155 addressable gap species, 60% is **≈ 693 species** —
which would take portrait coverage from 45.9% to roughly **78%**, and would do
most of its work in the marine half that nothing else has reached.

**One correction to the record while measuring:** spec 045 noted iNaturalist
returning 503 and treated the marine gap as unreachable. That was a network
condition at the time, not a property of the API. It answers normally from CI
and from this environment.

## Scope

**In:**

- `etl/sources/inaturalist.ts` — resolve one binomial to one commercially
  usable photograph, or nothing.
- A fourth route in `etl/build-images.ts`'s `resolve()`, after Commons and
  before the vendor listing.
- `Provenance` gains `'inaturalist'`; `portraitCredit` renders it as a stated
  licence with a named photographer, the same shape as Wikimedia, because that
  is what it is.
- Tests against a recorded API response, in the style of spec 056's fixture.

**Out:**

- **Any Seriously Fish image.** See above.
- CC BY-NC photographs, for the reason spec 031 rev 3 gives. This is left on
  the table knowingly: probe 1's licence histogram had `cc-by-nc` as the single
  largest bucket (20 of 48), so admitting NC would raise coverage further. It
  is a licence decision, not an engineering one, and it belongs to the product
  owner rather than to this spec.
- Backfilling the ~1,000 portraits that already exist. This is gap-fill only,
  matching `build-images.ts`'s existing idempotence.
- **Bundling all ~693 new portraits.** See the cost below — this spec builds
  and proves the route, and hands the size decision over rather than making it
  silently.

## The cost, measured rather than estimated

Portraits are **precached** by the service worker, deliberately: `vite.config.ts`
says a catalog that cannot draw itself offline has failed NFR-02.

The committed portrait directory is **1,011 files, 21.3 MB, mean 21.6 KB** at
`MAX_WIDTH = 480`, `QUALITY = 0.68`. At that mean, 693 more is **≈ 15 MB**,
taking the precache to **≈ 36 MB**.

That is a real number on a phone, and this project has shipped a portrait-budget
estimate that was off by 3× before. So it is stated here as measured-from-disk
arithmetic, and the decision it implies — precache everything, precache a
subset, or fetch the long tail on demand — is called out as **open** rather than
assumed. The pipeline is worth building either way; what gets bundled is a
separate question with a separate answer.

## Acceptance criteria

1. `npm run images` gains an `inaturalist` route and remains idempotent: a
   second consecutive run makes zero network calls for species already covered.
2. A taxon is accepted only on an exact, case-insensitive binomial match.
3. Only `cc0`, `cc-by`, `cc-by-sa` photographs are returned. A species whose
   only photographs are NC-licensed resolves to nothing and stays a gap.
4. Every returned row carries `license`, `artist` (the observer) and an
   `attributionUrl` pointing at the observation page a human can open — so it
   passes `isPublishable` on its merits, not on spec 002's loosened bar.
5. `portraitCredit` renders an iNaturalist portrait as `<photographer>,
   <licence>`, never as "Source not recorded".
6. Tests cover: exact-match accepted, near-miss binomial rejected, NC-only
   species rejected, and credit rendering.

## Alternatives rejected

**Take the Seriously Fish images.** Rejected on the licence statement, the
third-party rights, and the irreversibility of a public git history. Recorded
here rather than quietly skipped, because the request was explicit.

**Ask iNaturalist for `default_photo` only.** Simpler, one call per species,
and it is what probe 1 did — 15.4%. Rejected by measurement: it discards three
quarters of the reachable coverage for no benefit beyond a saved request.

**Admit CC BY-NC.** Would raise coverage materially. Rejected here as out of
scope rather than on the merits: spec 031 rev 3 settled the commercial question
for the whole project, and reopening it for portraits is the product owner's
call.

**Wait for a better source.** Nothing else evaluated reaches marine reef fish
at this scale, and the gap has been open since spec 002.

## Requirements touched

- **FR-R11** — "Licensed portrait sourcing with attribution, bundled and
  precached for offline use." Extends its source list; its backlog row still
  reads "700/1,076 species have one" and is stale on both figures.
- **NFR-02** — offline catalog. The precache cost above is this requirement's
  bill, which is why it is measured rather than assumed.
- **P6, never invent a number** — a species with no usable photograph keeps no
  portrait rather than borrowing a related species'.

---

## Revision 1: the gap was mostly unasked, not unanswerable

Written before running the pipeline; corrected after. The first real run —
`PORTRAIT_LIMIT=150 npm run images`, the 150 most-listed gap species — resolved
145 of 150, and the route breakdown is not what the section above implies:

| Route | Resolved |
|---|---:|
| Wikipedia article | 119 |
| Commons search | 11 |
| **iNaturalist** | **4** |
| Vendor listing | 11 |
| *nothing on any route* | *5* |

**Wikipedia answered 79% of species that this document called a gap.** That is
the correction: the 1,166 were not species every source lacks, they are largely
species nothing ever asked about. `build-images.ts` gap-fills only species with
no bundleable row, so a catalog that has grown to 2,155 accumulates species the
image pipeline has simply never been run against.

### What that does and does not change

**Wrong, and withdrawn:** the extrapolation "60% ≈ 693 species". That is
iNaturalist's **standalone** coverage of the gap list. It is not its **marginal**
contribution, because Wikipedia and Commons are tried first by design and get
there first for most species. Marginal contribution on this batch was **4 of
150, 2.7%**.

**Still true:** the 60% itself, as measured — probes 1 and 2 asked iNaturalist
alone, and the 4× difference between `default_photo` and the observation set is
a real property of the API that any future use of it needs to know.

**Still worth shipping:** those 4 species have a portrait that no other route
produced, and they cost one API call each on the species where the earlier
routes fail. The route sits below Commons precisely so it only runs then.

**And the batch is not representative.** `targets()` sorts by market listings
descending, so this run took the 150 most commonly sold fish — exactly the
species Wikipedia covers best. The obscure marine tail, which is where the gap
is concentrated, is where the earlier routes are expected to thin out and
iNaturalist to earn more. The full-run breakdown replaces this table when it
lands; until then, **2.7% is the number on record**, not an extrapolation from
it.

### The lesson worth keeping

The measurement that justified this spec was sound and answered the wrong
question. "Does iNaturalist have a usable photo for these species" is not "will
adding iNaturalist to this pipeline produce portraits", and only the second one
is the decision. A source probe measured in isolation will always overstate its
marginal value behind three routes that run first. Probe the pipeline, not the
source.
