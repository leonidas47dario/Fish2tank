# 070 — A card you can keep

**Status:** implemented.
**Date:** 2026-10-06.
**Touches:** FR-R02 (a unique card for each memorable specimen), FR-R06
(Golden, and BUG-23 which made it unreachable), FR-J01 (originals are never
replaced), NFR-04 (exact locations are never published), NFR-06, P3 (the exact
specimen matters), P6.
**Claims:** FR-R16 — a card of one fish, made from your own photograph, that
you can save to your photo library or send.
**Builds on:** spec 069 (the plan, and the sticker tokens this draws with).

---

## What was asked

The same request as spec 069:

> I really like the UI of this app so I would like you to come up with an
> enhancement plan to our app and then implement it

Spec 069's plan table maps Cat Collector's R03 (*"Generate a cutout sticker
card from the real photo, with a cat name, finder and place when
available"*) and R07 (*"Offer saving a share card to the device photo
library"*) here. This spec builds both, minus the cutout (spec 069 explains
why).

## The problem behind it

A fish's record is a working page: identity, price, screening, history. It is
the right page for doing things to a fish and the wrong thing to show anyone.
The only way to show someone the Panther today is a screenshot of a form, or
the raw photo with nothing on it saying what it is, where you met it or that
you were the one who found it.

The record does hold everything a card needs. What is missing is the object.

## What it does

A **Card** button in the record's top bar opens a sheet holding the card,
drawn as an image. That image *is* what gets saved, so the preview cannot
disagree with the file.

### What is on the card

Drawn from the record, each line only when the record has it (P6):

| Line | Source | When absent |
|---|---|---|
| The photograph | newest photo of this fish, `preview` rendition | **no card**; see below |
| Name | nickname, else common name, else shop label, else *Mystery catch* | (always something) |
| Kind | common name, when the name above is a nickname | omitted |
| Scientific name | the species', in italic | omitted |
| *Caught by …* | the keeper's chosen display name, else the account's name | omitted |
| Where | the place's name and branch, then its coarse locality | omitted |
| When | *Caught* + first encounter's date, else *Home since* + `acquiredOn` | omitted |
| ★ Golden | `specimen.golden` | no mark, paper edge |

Then *Fish2Tank* at the foot. No tier, no score, no price: spec 039 took the
species' rarity off the fish's record because it is identical for every
specimen, and a card of *this* fish is the same argument.

### A card needs your own photograph

With no photo of this fish, the sheet says so and points to the photo strip
rather than drawing the species portrait into a card. Two reasons:

1. **P3.** The card is a record of *this* fish. The species portrait is a
   picture of some other individual, taken by someone else.
2. **The licence.** Counted from `src/data/seed/marts/catalog.json` on
   2026-10-06: of the portraits carrying a licence string, **973 are CC BY-SA**
   (every version), **64 are NonCommercial or NoDerivatives**, and **150 have
   no licence or `unknown`** (vendor and web photos, spec 002). A composited
   card is arguably an adaptation; share-alike adaptations, an ND image in a
   composite, and NC in a commercial app (spec 031) are each a question not
   to settle inside a UI feature. Restricting the card to the keeper's own
   photograph removes all three.

### What never goes on it

- **Coordinates, ever** (NFR-04). The card reads `Place.name`, `branch` and
  `coarseLocation` (*"Free-text coarse locality … Safe to surface"* in
  `types.ts`) and nothing else of the place.
- **A home.** A place of type `home` is omitted entirely, even its name.
- **An email address.** The keeper's display name is used first. The
  account's name is used only if it does not look like an email: it comes
  from the sign-in provider, this app does not control what it holds, and a
  card is made to be sent to people.
- **A name that is not a name.** Signed out (developer mode, spec 013),
  Dexie Cloud's current user is named *Unauthorized*, and the first build of
  this card printed *Found by Unauthorized*. The account's name is now read
  only while `isLoggedIn`.
- **EXIF.** The image is re-encoded from a canvas, which writes none, so the
  original's camera metadata (including GPS) cannot ride along. Spec 064 made
  that true of uploads; this keeps it true of the card.

Two switches on the sheet, both on by default: **Show where** and **Show my
name**. Cat Collector's finder credit and place are the point of its card, so
they default on; turning one off redraws without it.

### Saving it

- Where the browser says it can share files (`navigator.canShare({ files })`),
  the button is **Save or send…** and opens the system share sheet. On iOS that sheet's
  *Save Image* is what puts it in the photo library, which is R07.
- Elsewhere it is **Download image**, an ordinary file download.
- **Cancelling** the share sheet is a normal outcome. It says *Not saved.
  Nothing changed.*, and nothing in the collection has changed.
- **A failure** says what failed and offers the download instead.

The image is made **when the sheet opens**, not when the button is pressed.
`navigator.share` needs a live user gesture, and Safari drops it across an
await as long as encoding a large JPEG. Drawing up front also makes the
preview the real file.

JPEG at quality 0.9, 1080 × 1350 (4:5, the portrait shape every photo app
displays without cropping).

### It follows the theme

Colours and fonts are read from the live tokens (`--color-*`,
`--sticker-edge`, `--font-*`) when the card is drawn, so a fieldbook keeper
gets a cream card and a midnight keeper a dark one, and `src/ui` still names
no colour (PRD 7.3).

### Golden, finally reachable (BUG-23)

FR-R06 has been P0 since the PRD and `awardGolden()` has existed with no
caller. The card is where Golden is seen, so the control lives on the sheet:
**Make it Golden**, with an optional reason that is private and never drawn
on the card (FR-R06: *"the reason may be recorded privately"*). A Golden fish
shows *Golden since …* and **Remove Golden**. That needs a `removeGolden()`
beside `awardGolden()`. Golden remains a personal overlay: neither function
touches a rarity snapshot, and the existing test that proves that for
`awardGolden` is extended to the removal.

## Acceptance

1. A fish with a photo shows a card on its record; one without says why not
   and draws nothing.
2. Every line on the card is absent when its source is absent; nothing is
   inferred.
3. A home place, an email-shaped name, and anything when its switch is off
   never reach the card.
4. Saving uses the system share sheet when files can be shared, and a
   download otherwise; a cancelled share changes nothing and says so.
5. Make Golden and Remove Golden round-trip, the reason never appears on the
   card, and no rarity snapshot changes.
6. No colour, radius, spacing or duration literal is added under `src/ui`.

1–3 are unit tests over the pure `catchCardContent()` in
`src/domain/catch-card.ts`, 5 extends `repositories.test.ts`, and 4 and 6
are checked on a running build.

## Verified on a running build

`npm run build`, preview, the smoke fixture restored, one catch made with
`docs/the-panther-original.jpg`, at 390 × 844:

- **Card** on the record opened the sheet and drew the card (dark theme
  above, then redrawn in Playful Collector and Expedition Fieldbook by
  toggling a switch: each read its own tokens).
- With a shop written onto the first encounter, *Aquarium Adventure Lincoln
  Park · Chicago area* appeared. The place record also carried a latitude and
  longitude, and neither reached the card.
- *Make it Golden* with a reason gave the foil edge and ★ Golden mark; the
  reason showed on the sheet only, not on the image; *Remove Golden* was
  offered.
- Headless Chromium on Linux reports no file sharing, so the button read
  *Download image* and a real download of `fish2tank-jaguar-cichlid.jpg`
  arrived. The share path (`canShare` true) is not exercised by this run and
  needs a phone; that is the one acceptance item checked by reading the code
  rather than running it.

## Alternatives rejected

- **Draw the card in HTML and screenshot it.** No browser API turns a DOM
  node into an image; it takes a library that re-implements CSS layout, a new
  dependency whose fidelity to this app's `oklch()` plates and `color-mix()`
  tokens would have to be proven. A canvas drawn directly needs nothing new.
- **Render the image on click.** Loses the user gesture on Safari (above).
- **PNG.** Measured on the running build, the same 1080 × 1350 card of the
  same photograph: **1,180,378 bytes as PNG, 181,151 as JPEG at 0.9**, 6.5×
  larger, for a file meant to be sent over a phone connection.
- **Put the Golden control on the reveal.** The reveal is skippable by
  design (FR-R04) and is seen once. Golden is often decided later, once a
  fish has turned out to matter.
