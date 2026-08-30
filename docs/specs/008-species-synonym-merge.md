# 008 - Merging one fish that arrived under two names

**Status:** built
**Date:** 2026-08-30
**Touches:** FR-D03 (match listings to a species by scientific name), FR-D04 (derive the dimension from what vendors list), FR-D05 (market price and scarcity), FR-I02 (manual species search), NFR-05 (transparency: every computed result exposes its sources and sample size).
**Closes:** BUG-02.
**Introduces:** `npm run synonyms:propose`, a verification step that refuses to merge without evidence.

---

## What was asked

> "resolve all outstanding bugs."

BUG-02, as filed: *"21 species pairs are the same fish under two names... Each half of a pair gets its own (smaller) sample of listings, so its median price and market scarcity are computed on roughly half the real evidence."*

Measured today: **23 groups, 47 species, and every single group has listings on
both sides.** Not 21. The largest is the tiger barb, 34 listings under `Puntius
tetrazona` and 22 under `Puntigrus tetrazona`, so both cards priced themselves
on about half the market.

## Why this is a correctness bug, not tidiness

NFR-05 says every computed result exposes its sample size. It does — and the
sample size is honest about the row while being wrong about the fish. A card
saying "median $8, 22 listings" is not lying about what it counted; it is
counting half of what exists, and nothing on screen can tell you that.

## The trap: a shared portrait is a hint, not proof

The existing detection signal is two species whose bundled portrait is
byte-identical after Commons redirect resolution. That is a strong hint and a
terrible decision rule. `Hymenochirus boettgeri` and `H. curtipes` share a
photograph because they are two dwarf frogs that look alike. Merging them
destroys a real distinction, permanently and silently: two fish become one and
nothing in the app says a species went missing.

So the shared portrait only **nominates** a group. Something else decides.

## What decides

Wikipedia's redirect graph plus its taxobox, which is a source asserting rather
than this repo inferring:

1. Look up every binomial in the group.
2. **If they all resolve to one article**, Wikipedia is asserting they are one
   taxon. That is the synonymy.
3. **That article's taxobox names the accepted binomial** (`| taxon = Danio
   rerio`). That is the direction.
4. Members landing on **different articles** means "these are two fish", and
   nothing is merged.

Both facts come from one place, and either one missing means no merge.
`wikipedia-text.ts` has always exposed the redirect as `WikiPage.redirected`,
with a comment calling it "a hint that our own binomial is a misspelling or a
superseded combination, which is worth recording even though this spec does not
act on it." This is the spec that acts on it.

### The first draft got direction wrong, and it matters

Worth recording, because it nearly shipped. The first version asked "which
group member does the redirect point at?" That fails for most of these fish,
because their articles are titled with a common name — *Zebrafish*, *Goldfish*,
*Bala shark* — which is not a binomial and matches no row. It then fell back on
searching for one binomial inside the other's synonyms block, which establishes
that two names are related and **nothing about which is current**.

It duly proposed folding `Balantiocheilos melanopterus` (correct spelling, 8
listings) into `Balantiocheilus` (a typo, 3), and `Carassius auratus` (86) into
its own subspecies (2). Both were caught by reading the output rather than by a
test. Reading the taxobox instead of guessing from the title fixed all of it.

## Results

| | |
|---|---|
| Candidate groups nominated | 23 |
| Merged, with evidence | **20** |
| **Refused** | **3** |
| Listings pooled onto a canonical id | **172** |
| Catalog rows | 2,176 → **2,155** |

The three refusals are the point of the exercise:

- **`Hymenochirus boettgeri` / `curtipes`** — separate articles. Two frogs.
- **`Maskaheros argenteus` / `Vieja argentea`** — separate articles.
- **`Corydoras aeneus` / `schultzei`** — one article, but its accepted binomial
  is `Osteogaster aenea`, which is *neither row*. Merging would need a new id
  and a decision nobody has made, so the tool declines and says why.

Spot-checked after rebuilding: tiger barb 34 + 22 → **56**, zebrafish 35 + 9 →
**44**, goldfish 86 + 2 → **88**, bala shark 8 + 3 → **11**.

## Three things a merge must not cost

Each was found by looking at real output, and each would have shipped quietly.

**1. The old name must still find the fish.** Dropping a row dropped its
binomial with it. Fine for a typo nobody types; not fine for `Brachydanio
rerio`, which is what a shop tag says. The dropped binomial and its aliases now
move onto the survivor, where `identifyFromText` already searches aliases.

**2. Stored records must still resolve.** A specimen identified before a merge
still points at the folded id. `CATALOG_BY_SPECIES` now also keys every folded
id to the surviving row, so no caller needs redirect logic and none can forget
it. Without this the app would appear to have forgotten a catch because a
taxonomist moved a genus.

**3. Researched names must survive.** Someone looked up Adolfo's catfish and
wrote `"Adolfo's Catfish"` against `sp_corydoras_adolfoi`. Folding that row left
the survivor named **"Adolfo S Hoplisoma"**, and `Puntius sachsii`'s "Gold Barb"
left its survivor called simply **"Barb"**. A derived name passes every test —
it is just worse, and the human research was silently discarded. `OVERRIDE_BY_ID`
now transfers an override to the id its subject folded into, unless that row has
research of its own.

## Ingest stays manual

`npm run synonyms:propose` writes `data/synonyms/proposals.jsonl` and stops. It
does not edit `species-overrides.ts`. Same shape as `care:plan` / `care:ingest`,
and for the same reason: a bad merge is silent and looks permanent. The tool
produces an argument; a person puts the surviving entries in with the source
attached.

## A doc correction this forced

`species-overrides.ts` claimed pooling listings "needs a full vendor re-scrape"
and that a fold "only takes effect on the next `npm run refresh`". Both were
true when written and are no longer: `npm run reindex` replays normalization
over the warehouse with no network. All 21 entries here were shipped that way,
from a machine that cannot reach three of the vendors at all. The docstring also
carried two contradictory copies of the same paragraph.

## Out of scope

- **Synonyms with no shared portrait.** Detection still starts from a bundled
  portrait, so a duplicate pair where neither row has one is invisible. A
  binomial-similarity sweep would find more and is not built.
- **`Osteogaster aenea`** and any merge that needs a new id.
- **Re-running against a fresh scrape.** Three vendors are unreachable from
  this network; the warehouse is the input.

## Acceptance criteria

1. A group whose binomials resolve to separate Wikipedia articles is never merged. ✓ (3 refused)
2. Canonical direction comes from the taxobox's accepted binomial, not from listing counts or ordering. ✓
3. A curated id wins over a derived one for the same taxon, so stored records keep resolving. ✓ (`sp_panda_cory`, `sp_cuckoo_catfish`, `sp_snakehead_gudgeon`)
4. Listings pool: the canonical id's count equals the sum of the group's. ✓ (56, 44, 88, 11)
5. Searching a folded binomial still finds the surviving species. ✓
6. `CATALOG_BY_SPECIES.get(foldedId)` returns the surviving row. ✓
7. A researched common name survives the merge of the row it was written for. ✓
8. Every synonym entry carries a reason and a source URL. ✓
