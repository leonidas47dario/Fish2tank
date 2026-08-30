# 009 - Classifying the reef

**Status:** built
**Date:** 2026-08-30
**Touches:** FR-D04 (derive the dimension from what vendors list), FR-D07 (decide whether plants and invertebrates belong in the fish catalog, and give them a facet), FR-R10 (catalog filter chips).
**Closes:** BUG-03, and answers FR-D07.
**Introduces:** `npm run genera:classify`.

---

## What was asked

> "resolve all outstanding bugs."

BUG-03: *"47 catalog rows are plants or invertebrates, not fish... They count toward the species and appear in the fish catalog with no facet to filter them out."*

## Two things in that sentence were wrong

**There is a facet.** `Catalog.tsx` has had an organism-kind filter — Everything
/ Fish / Inverts / Plants — and a salinity filter that already defaults to
freshwater. The bug was filed before they were built, and never revisited.

**It is not 47 rows, and the problem is not plants.** Measured:

| | |
|---|---|
| Plants | 142 |
| Invertebrates | 100 |
| **Unclassified** | **954** |

954 of 2,155 species carried no `organismKind` at all, so the facet could not
filter them however it was set. And **854 of those 954 are marine** — reef stock
that arrived with a saltwater vendor long after `taxonomy.ts` was hand-compiled
against a freshwater catalog. The catalog is 868 saltwater species out of 2,155,
about 40%.

So the real question was never "do plants belong here". It was "what do we do
about a catalog that is 40% fish this keeper cannot house, 44% of which the app
cannot even classify". Put to Ryan, who chose: **freshwater by default,
saltwater opt-in — which already works — and finish the classification anyway,**
since it is what makes the kind facet trustworthy.

## Why this could be automated when the original could not

`taxonomy.ts` explains its hand-compiled tables plainly: FishBase and Wikidata
are unreachable from this network, and Wikipedia's *prose* does not reliably
state what it needed (*"the Hypostomus plecostomus article runs 6,500 characters
without once saying bottom-dwelling"*). Both still true.

But Wikipedia also publishes its taxonomic hierarchy as **machine-readable
templates**. `Template:Taxonomy/Chaetodon` is literally `|rank=genus
|parent=Chaetodontidae`. Walking that chain upward is neither prose nor
inference; it is the encyclopedia's own structured claim, followed link by link.

- **Family**: walk up until a node says `rank=familia`. A walk, not a lookup —
  `Cirrhilabrus` hangs off a subfamily, `Zebrasoma` off a tribe.
- **Kind**: keep walking to a clade that settles it. An ancestor of
  Actinopterygii is a fish; of Cnidaria or Echinodermata, an invertebrate.
- **Zone**: **not derived.** Where an animal sits in the water column is not
  recoverable from taxonomy at this confidence, and this module's own rule is
  that an unsourced zone stays absent rather than becoming a guess. New families
  arrive with a kind and no zone.

The chains converge hard — 437 genera collapse to 207 distinct parents, then
133, then 86 — so the whole run is a few hundred requests.

## The homonym trap

`Culcita` is a genus of **tree fern** and a genus of **cushion starfish**.
Wikipedia's template answers with the fern. An aquarium vendor is selling the
starfish, and nothing in the genus name distinguishes them.

So a derived kind is cross-checked against an *independent* source — what the
vendors say about the water it lives in. Taxonomy saying "land plant" while
every listing is marine is a homonym, not a discovery, and it is reported rather
than resolved. Two were caught this way.

That guard turned out to be right in a way that was checkable: `taxonomy.ts`
already carried `Aegle: 'Aegla'` in `MISSPELLED_GENERA` — a freshwater crab, not
the plant genus Wikipedia returns. The repo already knew, and the guard
independently reached the same answer.

## Results

| | before | after |
|---|---|---|
| `organismKind` coverage | 55.7% | **96.6%** |
| Unclassified | 954 | **74** |
| Unclassified *freshwater* | ~77 | **31** |

368 of 437 genera resolved to both a family and a kind, adding 128 families and
882 classified species: 671 fish, 181 invertebrates, 29 plants, 1 reptile.

Spot-checked against reality rather than counted: `Acropora` → invertebrate
(coral), `Chaetodon` → Chaetodontidae, `Amphiprion` → Pomacentridae,
`Zebrasoma` → Acanthuridae, `Culcita` → correctly left unset.

Verified in a browser on the built app, freshwater default: **Fish 958, Inverts
102, Plants 144, Everything 1,241.**

## The tail, and what it actually is

67 genera did not resolve, covering 70 species. **60 have no Wikipedia taxonomy
template at all**, and reading them explains why: they are vendor misspellings
the derivation minted as genera — `Crencichla` and `Crenincichla` for
Crenicichla, `Apolcheilus` for Aplocheilus, `Moenkausia` for Moenkhausia,
`Poecillia` for Poecilia, `Chladophora` for Cladophora — plus eight that are not
genera at all: `African`, `Dwarf`, `Indian`, `Madagascan`, `Native`, `Peacock`,
`Spiney`, `Dorado`.

Ten were already in `MISSPELLED_GENERA`. The other 57 are **not a classification
problem**; they are the same defect class as BUG-02 and FR-D08 — the derivation
minting junk from vendor typos — and they are filed there with the measured
list rather than smuggled into a taxonomy change. Each is one or two species,
and almost all are marine.

## Out of scope

- **The 57 unminted misspellings.** Filed; each needs a human to say what it is
  a misspelling *of*, and several (`Diadema`, `Turbinaria`, `Siderea`) are valid
  genera that simply lack a template.
- **Water-column zone for the 128 new families.** Deliberately absent.
- **Dropping marine species.** Considered and rejected by Ryan: the filter
  already hides them, and removing them forecloses ever keeping a reef tank.

## Acceptance criteria

1. A genus's family and kind come from Wikipedia's taxonomy templates, not from prose or inference. ✓
2. Water-column zone is never derived. ✓ (128 new families carry a kind and no zone)
3. A genus whose derived kind disagrees with what the vendors sell is reported, not applied. ✓ (`Culcita`, `Aegle`)
4. The tool writes a proposal and edits no source file. ✓
5. `organismKind` coverage above 95%. ✓ (96.6%)
6. The catalog's kind facet returns sensible counts on the built app. ✓
7. Nothing that failed to resolve is guessed at. ✓ (74 species remain unset)
