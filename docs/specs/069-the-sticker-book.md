# 069 — The sticker book, and what we are taking from Cat Collector

**Status:** implemented.
**Date:** 2026-10-06.
**Touches:** FR-R02 (a unique card for each memorable specimen), FR-R06
(Golden), FR-R09 (filter by status), NFR-06 (colour is never the only cue), P6.
**Claims:** FR-R15 — every fish you have met or kept, one sticker each, in one
place, filterable by how it became yours.
**Followed by:** spec 070, the card of one fish as an image you can keep.

---

## What was asked

> I really like the UI of this app so I would like you to come up with an
> enhancement plan to our app and then implement it

"This app" is Cat Collector, delivered as a feature-requirements document
(`Cat_Collector_Feature_Requirements.docx`, v1.0, 5 October 2026; 18
requirements R01–R18, five open decisions D01–D05). The document describes
features rather than showing screens. The only visual evidence it names is one
App Store screenshot (its S0), described as showing *"All, Caught and
Collected sticker filters"* in a sticker drawer. The supplied URLs for the
guides could not be fetched from this environment (the network policy refused
`catcollector.app`), so everything below works from the document's own words.

## The problem behind it

What Cat Collector does that Fish2Tank does not is make **one encounter feel
like an object you own**: the photograph becomes a card or sticker with the
animal's name, who found it and where, and every one of them sits together in
a drawer you can browse and filter.

Fish2Tank has the records for that and not the object:

- The **catalog** is per *species*. Two jaguar cichlids, today's Panther and
  last year's smaller one, are one tile. FR-R02 asked for *"a unique card for
  each memorable specimen"* and the PRD's own acceptance test is exactly that
  pair remaining separate cards.
- **Home** shows the eight most recent catches and stops.
- A fish's **record** is a long working page (identity, price, screening,
  timeline), which is right for the work and is not a thing you would show
  anyone.

So there is no screen anywhere that shows *every fish you have met*, one each.
PRD 3.2 had one in mind: its Collection destination lists *"unique specimen
cards"* beside the species index, and only the species index was built. That
is the gap, and it is the first thing this plan fills.

### Why the catalog tile is not being turned back into a card

`Tile.tsx` records why the collectible-card catalog was removed: its format was
three numbers (price, adult size, minimum tank) and the catalog has both size
and tank volume for 92 of 2,178 species. That argument is about *species*
facts, which are mostly missing. A sticker of *your fish* is built from facts
that always exist for it: a picture, a name, a date. The objection does not
apply to it, and nothing in this plan reverses that decision.

## The plan: Cat Collector's requirements against this app

Every requirement in the document, with what happens to it here. "Have it"
means Fish2Tank already does the substance; the reference is where.

| CC | Requirement | Here |
|---|---|---|
| R01 | Profile with a username | **Have it.** Spec 010 (account required), spec 017 (the name is the account's). |
| R02 | Capture with on-device verification | **Have the capture, refuse the gate.** A fish in a shop tank behind glass and reflections is exactly where a detector rejects real catches, and the document's only user complaint (S9) is failed detection. Fish2Tank lets a catch be *Unknown* and identified later (FR-I01); a gate would undo that. |
| R03 | A cutout sticker card with name, finder and place | **Spec 070** — the card, as an image. True background removal is out: see below. |
| R04 | A collection of caught and collected, with All / Caught / Collected filters, no duplicates | **This spec.** The sticker book. |
| R05 | Rename what you created | **Have it.** Nickname (FR-J04), inline editing (specs 039–041). |
| R06 | A link that lets someone else collect your cat | **Partly have it.** A shared tank (spec 023) lets a guest heart a fish onto their own Dream List. Collecting *another keeper's specimen* needs a shared record store; not planned. |
| R07 | Save a share card to the photo library | **Spec 070.** |
| R08 | iMessage stickers | **Out.** A web app cannot register a Messages extension. The image spec 070 saves can be sent from Photos, which is the honest version. |
| R09 | Discovery feed and following | **Out for now.** Fish2Tank has no public records and no record API (ENH-08 is blocked on that); a feed needs both. |
| R10 | Map of encounter locations | **Out.** NFR-04: exact store and home locations are never published. The document's own D01 says Cat Collector has not resolved this either. |
| R11–R14 | Rankings, daily contest, gems, paid packs | **Out.** These are a currency and a game economy. FR-R07 already refuses to claim objective rarity without a sample, and a "top fish of the day" would be exactly that claim. |
| R15 | Notifications when someone collects | **Out.** Nothing to notify about without R06/R09. |
| R16 | Reporting and blocking | **Out.** Nothing user-generated is discoverable, so nothing to report. |
| R17 | Optional permissions | **Have it.** No location is ever requested; the camera input is optional (spec 020). Spec 070's share sheet keeps the same rule. |
| R18 | Persistence and data deletion | **Have it.** Dexie Cloud sync (spec 005), Erase everything (spec 016, 028). |

What is left after that table is two features, and they are the two that are
*the UI the request liked*: the drawer of stickers (this spec) and the card
you can keep (spec 070).

### Rejected: true cutout stickers

Cat Collector cuts the cat out of its background. Doing that for fish needs a
segmentation model shipped to the device, and no candidate has been chosen or
measured here, so this spec states no size for one. What is measured is the
budget it would join: a portrait precache already argued over at ≈36 MB
(ENH-20). A model that cuts the fins off a betta is also worse than no
cutout. So the sticker here is **die-cut**: the
whole photograph inside a thick paper-coloured edge, tilted as if stuck to a
page. It reads as a sticker and never removes a pixel of the fish. If a
cutout is ever wanted it is its own spec, with a model chosen and measured.

## The sticker book

A new screen at `#/stickers`, reached from Home ("Sticker book", beside
*Recent catches*). Not a sixth nav item: PRD 3.2 fixed the bar at five, and
the redesign kept it.

### One sticker per fish

- **Every specimen** is a sticker: everything you photographed in a shop, and
  every kept fish that has a record.
- **A kept fish with no record yet** (an imported inventory row nobody has
  opened) is a sticker too. Tapping it mints the record first, the same way
  the species page already does (`ensureSpecimenForHolding`). Leaving those
  out would make the book disagree with the tanks.

Newest first.

### Filters

`All · Caught · Kept · Golden`, each with its count.

- **Caught** means the fish has at least one encounter, i.e. you met it
  somewhere.
- **Kept** means it has a holding, now or in the past. A fish you no longer
  keep is still a fish you kept; it says *No longer kept* on the sticker
  rather than dropping out of the filter. That is the species page's wording
  for the same fact, and it is deliberately not "Departed": a fish rehomed or
  sold is in this state too.
- **Golden** (FR-R06) appears only when at least one fish is Golden, so the
  row never offers a filter that can only ever show nothing.

Cat Collector's third word is *Collected* (from another person). That has no
meaning here until R06 exists, so it is not borrowed.

A fish you caught and then brought home is in **both** Caught and Kept, and
once in each. That is the document's R04 acceptance check (*"Filtering returns
the appropriate entries without duplicating them"*), and it is a unit test.

### What a sticker shows

- **The picture of this fish**, newest photo first; else the species'
  portrait; else the designed "No portrait" plate. Same precedence as the
  Home shelf.
- **The name**: nickname, else the species' common name, else the shop's
  label, else *Mystery catch*. Same order as the Home shelf.
- **One line of when**: *Caught* and the first encounter's date; else *Home
  since* and the day it came home (`Holding.acquiredOn`); else **nothing**.
  Never `createdAt`: for the 61 imported fish that is the minute a
  spreadsheet was read (spec 037), and for a catch it is when the row was
  written, not when the fish was met (spec 040). Fish with no date sort after
  every dated one.
- **A mark only when there is something to say**: ★ Golden, and/or *No
  longer kept*. Each carries a word, never just a colour (NFR-06).

Nothing else. A sticker carries no rarity tier (spec 039 took tier off the
fish record because it is a fact about the species, identical for every
specimen) and no price.

### What it looks like

Paper-edged, rounded, tilted a degree or two in a repeating pattern so a page
of them reads as stuck down by hand, straightening on hover and focus. Golden
stickers get a foil edge in `--color-legendary`. All of it is new tokens in
`tokens.css` (`--sticker-edge`, `--sticker-edge-width`, `--radius-sticker`,
`--sticker-tilt`, `--elevation-sticker`) with values for all three
territories, so a theme change is still a token swap (PRD 7.3). The tilt is a
static transform rather than an animation, so it needs nothing for reduced
motion; the hover transition already reads `--duration-base`, which reduced
motion sets to zero.

## Acceptance

1. `#/stickers` lists every specimen, plus every holding with no specimen,
   exactly once under *All*.
2. A fish with an encounter and a holding appears once under *Caught* and
   once under *Kept*.
3. A fish no longer kept is under *Kept* and is marked *No longer kept*.
4. *Golden* is offered only when a Golden fish exists.
5. The chip counts equal the number of stickers each filter shows.
6. Tapping a sticker with no record opens a newly minted record; tapping one
   with a record opens it.
7. An empty collection says so and offers the way to make a first catch,
   rather than an empty grid.
8. No colour, radius, spacing or duration literal is added under `src/ui`.

1–5 are unit tests over the pure `stickerBook()` in
`src/domain/sticker-book.ts`. 6–8 are checked on a running build.

## Found while building it: Golden cannot be awarded

FR-R06 is P0 (*"User may mark any meaningful specimen Golden"*), and
`awardGolden()` exists in `repositories.ts`, but **nothing in the UI calls
it**. Every Golden treatment in the app (the reveal's foil, the catalog's
golden flag, this book's foil edge and filter) is drawing a field no keeper
can set. The book's *Golden* chip is hidden while the count is zero, so it
offers nothing dead; the foil was checked by writing the field directly.
Spec 070 puts the control on the fish's card, which is where Golden is seen.
Filed as BUG-23.

## Verified on a running build

`npm run build`, preview, then the smoke fixture restored through Settings
and one real catch made with `docs/the-panther-original.jpg`, at 390×844:

- *All 62 · Caught 1 · Kept 61*: the fixture's 61 inventory holdings plus
  the one catch. Every count equals the stickers its filter shows.
- Tapping the first *Kept* sticker, a holding with no record, minted one and
  opened `#/specimen/…`.
- With Golden and a death written straight into IndexedDB, *Golden 1*
  appeared, the foil edge and ★ Golden mark drew, and the dead fish read *No
  longer kept*.
- All three territories rendered with no new console errors (the only ones
  were the sandbox refusing outbound network).

Every fixture holding draws *No portrait*, which is correct rather than a
gap in this screen: none of the 61 carries a `speciesId`, and the tank grid
draws the same rows the same way.

## Alternatives rejected

- **Put specimens into the catalog grid.** The catalog is per species by
  design (its header comment explains why one browser rather than two) and is
  windowed for 2,178 entries. Mixing in per-fish tiles breaks both.
- **Restyle the Home shelf instead of a new screen.** The shelf stops at
  eight on purpose; the problem is that *nothing* goes past eight.
- **A sixth nav destination.** See above.
