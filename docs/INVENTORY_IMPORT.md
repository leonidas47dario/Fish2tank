# Importing the fish inventory

Implements FR-O03 and the migration rules in PRD 6.2.

## The file

The PRD references `fish_inventory.xlsx` — 61 holding rows on a "Fish Inventory"
sheet, across six enclosure labels: **75G, Breeder Tote, Quarantine, Bass Tote,
Mini Tank, Predator Tank**. That file was not supplied with the PRD, so the
importer is written to the documented column contract rather than to the actual
sheet, and is tested against a synthetic 61-row fixture.

## How to load it

1. Open the workbook and export the Fish Inventory sheet as **CSV**.
2. In the app: **Settings → Import inventory → choose the file.**
3. Read the row-by-row report. Every row is listed, with whether its species
   resolved or still needs confirming.

## Columns

Header matching is case-insensitive and order-independent; a header only has to
*contain* the keyword.

| Column | Keywords matched | Migration rule |
|---|---|---|
| Tank | `tank`, `enclosure` | Creates or matches a physical Aquarium. Totes and quarantine bins stay valid enclosure types, not malformed tanks. |
| Species / Description | `species`, `description` | Kept **verbatim** as the holding's raw label. Mapped to a catalog species only on an exact match. |
| Quantity | `quantity`, `qty`, `count` | Becomes the opening balance. A blank or unreadable value becomes 1, never 0. |
| Category | `category`, `class` | Preserved as a livestock tag (Fish, Invert, Amphibian). |
| Notes | `notes`, `note` | Preserved verbatim. |

## What the importer will not do

The three guardrails from PRD 6.2, each covered by a test:

- **No merging.** Every row becomes its own Holding. The same species in two
  tanks stays two records — they are two different groups of animals.
- **No invented history.** No `acquired` event is written and no arrival date is
  guessed. The opening quantity is a balance, not a claim about the past.
- **No forced identity.** `unclear ID`, `jaguar cichlid?` and anything else that
  is not an exact catalog match stays raw, with no species assigned, for you to
  confirm later (FR-O05).

## After importing

Imported tanks have **no volume and no dimensions** — those columns do not exist
in the source. Until you measure each one under **Tanks → Edit**, compatibility
screening for that tank honestly returns *Not enough data*. That is FR-E05
working, not a bug; a guessed volume would produce confident answers built on
nothing.

Matching against an existing tank is by name, case-insensitive, so importing
into the seeded six labels adds holdings to them rather than creating duplicates.
