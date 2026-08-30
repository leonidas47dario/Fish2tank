# 015 — Three seed runs, one collection, and the repair that unpicks them

## What was asked

> all my fish in the prod account under leonidas is duplicated 3 times!

and, once the cause was known:

> so are you saying that it was a old bug and this should not have happen in
> the future? when did it got fixed? Are there any code change needed to be
> pushed to UAT to resolve this?

> I am gonna step out for a bit, so fix my account

## The problem

Production holds **176 holdings and 176 residencies, exactly one residency per
holding**. That single fact rules out the first hypothesis: the tank grid
(`useTankResidents`) iterates residencies and resolves one holding each, so
three tiles per fish could have been three residencies fanning out over one
holding. It is not. These are 176 real rows.

Their `createdAt` values fall into three bulk writes and two singletons:

| When (UTC) | Rows |
|---|---|
| 2026-08-27 15:57:46 | 59 |
| 2026-08-29 04:00:10 | 61 |
| 2026-08-29 07:29:56 | 54 |
| two rows added by hand | 2 |

Every one of the 176 ids is a random UUID (`hold_<uuid4>`).

That dates all three runs before `ea7accc` (2026-08-29 22:26 CDT), which is
the commit that had already found this exact bug while building spec 006:

> Import was not duplicating its own rows; `importInventory` minted a fresh
> UUID per row on every run […] Seeding was never idempotent and nothing had
> made that visible.

`applyInventoryImport` merges aquariums **by name** but writes holdings keyed
by id, which is why seven tanks stayed seven tanks while the fish tripled.

## Was it fixed, and is more code needed to stop it?

**Two changes already shipped to `uat` and `main`, and between them the
specific failure cannot recur:**

1. `ea7accc` — inventory ids are derived from row content (`stableId`, FNV-1a)
   and `applyInventoryImport` uses `bulkPut`, so re-importing the same sheet
   updates rows instead of adding them.
2. `3103813` — `bootstrap()` no longer seeds a collection at all. It seeds the
   species catalog and nothing else. The three bulk runs above were almost
   certainly first-run seeding on three separate local databases, and that
   code path no longer exists.

Neither can heal the existing rows: `bulkPut` keys on id and all 176 differ.
So **no code change is required to prevent recurrence, and a data repair is
required to fix what is already there.** That repair is this spec.

### One residual hazard, recorded rather than fixed here

`stableId('hold', String(index), label, row.speciesDescription)` keys on the
row's **position in the sheet**. Insert or delete a row and every id below it
changes, and since `applyInventoryImport` only ever `bulkPut`s and never
reconciles, the old rows stay beside the new ones. Editing a species
description or renaming a tank does the same for that row. The blast radius is
far smaller than the original bug and it needs a deliberate design decision
(reconcile against the sheet, or key on content alone and accept that two
identical rows collapse), so it is filed as **BUG-07** rather than fixed
opportunistically inside a repair.

## Scope

**In:** a pure planner that decides which duplicate survives; a CLI that
applies it against the Dexie Cloud REST API and verifies the result.

**Out:** an in-app "deduplicate" button. Nothing in the app can create this
damage again, so a permanent control would be a button for a bug that cannot
happen. Out too: the BUG-07 reconciliation above, and any change to the
importer, which is already correct for its own next run.

## What counts as one fish

`(speciesId, rawLabel, current tank)`.

The tank is in the key because Ryan keeps guppies in two tanks, and those are
two legitimate rows. The group that looked like a ×6 duplicate is ×2
legitimate rows caught by three runs. Verified against the export: **within
any single run, no (species, label, tank) ever repeats**, so every row past
the first in a group is import damage and nothing else.

Holdings with no *open* residency are excluded from grouping entirely. Two
qualify — a Betta and "Neobasher (unclear ID)", both with residencies closed
on 2026-08-28 and 2026-08-30. They are past-kept history, the tank view
already hides them, and grouping a fish by a tank it has left would merge it
with a stranger.

## Which copy survives, and why not the oldest

**The richest: catch link, then life events, then a note, with the oldest
`createdAt` breaking the tie.**

"Keep the oldest" is the obvious rule and the real data disproves it. Dry-run
against production it would have deleted **two holdings linked to real logged
catches and one carrying life events**, because those attachments landed on
whichever copy happened to be on screen at the time. Keeping the newest is no
better: it loses two rows with life events instead.

| Rule | Catch links lost | Life events lost | Distinct notes lost |
|---|---|---|---|
| oldest | 2 | 1 | 0 |
| newest | 0 | 2 | 0 |
| **richest, then oldest** | **0** | **0** | **0** |

The total fish count is 138 under every rule, so nothing was traded for this.

## Acceptance criteria

1. `planDedupe` is pure, unit tested, and shared by the CLI — the CLI decides
   nothing about which row survives. ✅ 14 tests.
2. Dry run is the default; `--apply` is explicit. ✅
3. The tool logs the target database URL and client id before touching
   anything (NFR-13). ✅
4. It refuses outright if any row it means to delete carries a catch link,
   life events, or a note the survivor lacks. ✅
5. It writes a pre-image of every doomed record before the first DELETE. ✅
6. Residencies are deleted before holdings, so no dangling reference exists
   even midway. ✅
7. It re-reads the database afterwards and fails non-zero unless the counts
   match the plan with zero stragglers and zero dangling residencies. Green
   means verified. ✅
8. Running it twice is safe and the second run reports nothing to do. ✅

## Run against production, 2026-08-30

```
[repair] read { holdings: 176, residencies: 176, lifeEvents: 5 }
[repair] plan { before: 176, after: 65, removing: 111, notesAtRisk: 0, skippedWithoutTank: 2 }
[repair] delete calls accepted { residencies: '111/111', holdings: '111/111' }
[repair] verified { holdings: '176 -> 65 (expected 65)', residencies: '176 -> 65',
                    stragglers: 0, danglingResidencies: 0 }
```

Confirmed afterwards by an independent `npx dexie-cloud export`, which never
consults the tool that did the work: zero duplicate signatures remain, all four
catch links survive, and specimens, media, encounters, assessments and
identifications are unchanged at 30, 34, 29, 42 and 31. Restore points are in
`~/fish2tank-backups/`.

## Alternatives rejected

- **`npx dexie-cloud clear-table holdings` then re-import the good rows.**
  Table-granular and therefore blunt, and worse, a client still holding all
  176 rows locally could push them back. Row-level DELETE through the REST API
  produces real server-side deletions that propagate.
- **Wipe the profile and re-import the spreadsheet.** This was Ryan's first
  instinct and it loses data. The three runs were 59, 61 and 54 rows because
  the sheet kept changing, so the deduplicated union (65) is larger than any
  single run, and the sheet carries none of the 30 specimens, 34 media, 29
  encounters, 42 assessments or 31 identifications.
- **A browser console script.** `db` is not exposed on `window`, so a console
  script cannot reach the cloud-attached Dexie instance and its deletions
  would never sync.

## Requirements touched

FR-T02, FR-T03 (holdings and residencies), FR-A01 (which tables sync),
NFR-13 (say which tier you are writing to, out loud).
