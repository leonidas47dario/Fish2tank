# Importing the fish inventory

> **Retired in spec 017. There is no longer a way to import a spreadsheet from
> inside the app.** The Settings section is gone, and with it
> `src/data/import-service.ts` and the `.xlsx` reader `src/data/seed/xlsx.ts`.
> Backup and restore (spec 006) is the supported way to move a collection now:
> it carries photos, specimens, encounters and assessments, none of which a
> spreadsheet has.
>
> Two reasons beyond redundancy. The importer never reconciled - it only
> `bulkPut`, so re-importing an *edited* sheet left the old rows beside the new
> ones (**BUG-07**), and that path is now unreachable. And a non-idempotent
> earlier version of it is what put 176 holdings in production where there were
> 63 fish (**spec 015**).
>
> `src/data/seed/inventory-import.ts` survives, because
> `etl/build-smoke-fixture.ts` still uses `parseInventoryCsv` and
> `importInventory` to generate the smoke-test fixture. Everything below
> describes the source workbook and the parsing rules, which are still accurate
> for that use; the "How to load a newer version" steps are not.

Implements FR-O03 and the migration rules in PRD 6.2.

## The file

`fish_inventory.xlsx` — 61 holding rows on a "Fish Inventory" sheet, across six
enclosure labels: **75G (19), Mini Tank (18), Predator Tank (15), Quarantine
(6), Breeder Tote (2), Bass Tote (1)**. 136 animals in total: 54 fish rows, 6
invert rows, 1 amphibian.

The workbook is committed at [`fish_inventory.xlsx`](fish_inventory.xlsx) and
its contents ship as the app's first-run seed data, so a fresh install already
holds the real inventory. The tests read the real workbook rather than a
fixture.

## How to load a newer version

1. In the app: **Settings → Import inventory → choose the file.**
2. Pick either the **`.xlsx` directly** or a CSV export — both work.
3. Read the row-by-row report. Every row is listed, with whether its species
   resolved or still needs confirming.

The `.xlsx` reader is dependency-free: an .xlsx is a ZIP of XML, and it is
unzipped with the platform's own `DecompressionStream` (Safari 16.4+, Chrome
80+). No spreadsheet library is bundled for one import screen.

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
