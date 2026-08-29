# 001 — Requirements discipline

**Status:** proposed
**Date:** 2026-08-28
**Touches:** no FR/NFR. This is process, not product.
**Introduces:** the `FR-D##` category and the spec/backlog convention that later specs use.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "I think this project had lacked discipline in tracking requirements/feature/bugs
> etc. what can we do to add those disciplines? perhaps fold into a Claude.md into
> this project? There should have had been a proper product requirement doc, but
> ever since most requirements I provided are quick feedbacks, and probably got
> built without a lot of long term thinking."

Asked to pick the failures worth stopping, the answer was three of four:
**building before thinking**, **docs drifting from reality**, **no bug list**.
Explicitly *not* chosen: "losing the thread." No index is being built for its
own sake.

Two follow-up decisions, also given directly:

- The thinking gate **writes but does not block**. Quick feedback stays quick.
- Specs and bugs live as **in-repo markdown**, not GitHub Issues.

## The problem, stated accurately

The premise in the request is half right, and the half that is wrong changes
the design.

There *is* a proper PRD: `docs/PRD.md`, 600 lines, 75 numbered FR/NFR
requirements. And **58 of those 75 IDs are already cited in code comments**
(`FR-T02` in the holdings model, `NFR-02` in the portrait precache, `FR-O05`
in the importer). Traceability is over three quarters built, by habit rather
than by rule.

The commit bodies are the other surprise. They carry root cause, measured
numbers, and rejected alternatives — the `f40ed4f` message diagnoses a design
error, quantifies the fix (249 → 6,409 listings matched), and logs two
performance problems rather than hiding them. The long-term thinking the
request worries was missing largely did happen.

So the failure is not absent thinking. It is that **the thinking lands only in
git log, where it cannot be reviewed before the code exists, queried after, or
contradicted by a test.** Four concrete gaps follow from that:

| Gap | Evidence |
|---|---|
| No `CLAUDE.md` | Conventions re-derived every session. Nothing states the branch flow, the marts-are-generated rule, or the no-literals-in-`src/ui` rule to a fresh agent. |
| No intake surface | Issues are enabled and **zero have ever been filed**. All nine numbers are PRs. A requirement's first written form is the commit that implements it. |
| Post-PRD requirements are unnumbered | The catalog, the warehouse, the eight vendors, portraits and kept-fish ownership carry no ID and no acceptance criteria, so they are second-class next to the original 75. |
| Nothing asserts prose | The README claimed 182 tests against 332, 47 species against 1,080, 3 vendors against 8. It drifted for three PRs in silence. `docs/MARKET_ETL.md` and `docs/RELEASING.md` are still wrong today. |

## Scope

### In

1. **`CLAUDE.md`** at the repo root — conventions plus one gate rule.
2. **`docs/BACKLOG.md`** — bugs, unbuilt requirements, and post-PRD requirements
   given IDs.
3. **`src/docs.test.ts`** — asserts documented facts against real data, wired
   into the existing CI job.
4. **Fixing the two already-stale docs** (`MARKET_ETL.md`, `RELEASING.md`),
   because the drift test fails on them otherwise and shipping a knowingly-red
   test is worse than not having one.

### Out

GitHub Issues, labels, milestones, templates, estimation, status workflow, a
requirements index, and any automated cross-reference between FR IDs and code.
None were asked for; "losing the thread" was the one failure not selected.

Also out: retro-fitting acceptance criteria onto the original 75 PRD
requirements. They have prose definitions already.

---

## Design

### 1. `CLAUDE.md` — the gate

The gate binds the agent, not the human. Its load-bearing rule:

> Before writing code for anything beyond a typo or a one-line fix, write
> `docs/specs/NNN-slug.md` first, in the same commit or earlier. **Do not wait
> for approval.** The spec states: what was asked (quoted verbatim), the
> problem behind it, what is in and out of scope, acceptance criteria,
> alternatives rejected and why, and the FR/NFR IDs it touches or the new ID
> it claims.

The reviewable artifact is therefore the spec *and* the diff, side by side, in
one PR. Quick feedback still becomes code in one session; what changes is that
it cannot become code without a written argument that can be disagreed with.

`CLAUDE.md` also carries the conventions currently held only in people's heads
or inferable only by reading three files: branch flow `feature → uat → main`;
`src/data/seed/marts/` is generated and never hand-edited; `src/ui` contains no
colour, radius or duration literal; engines stay pure functions of
`(stored inputs, versioned config)`; never invent a number; cite FR IDs in code
comments when implementing one.

### 2. `docs/BACKLOG.md` — the record

One file, three tables.

**Bugs** — known-broken, with a repro line and the file if known. Distinct from
"not built," which is the next table.

**Unbuilt** — the P1/P2 list currently living in README prose, where it rotted.
Moving it here means the README describes what *is*, and one file describes
what *is not*. Each row carries its PRD FR ID.

**Post-PRD requirements** — everything built since the PRD, given an ID
retroactively so it is traceable like the original 75.

ID scheme extends the PRD's existing `FR-<letter><nn>` rather than inventing a
parallel one. Existing letters are reused where the work fits (portraits and
the card grid are collection concerns, so `FR-R##`). One new letter is
introduced because the area is genuinely new:

- **`FR-D##` — Data pipeline and warehouse.** The vendor ETL, normalization,
  the Parquet star schema, and the refresh contract. Nothing in the PRD
  anticipated a warehouse.

New requirements arriving as feedback get an ID here at intake, before the
spec is written.

The agent maintains this file. It is not a human chore.

### 3. `src/docs.test.ts` — the drift guard

Parses documented figures out of `README.md` and `docs/MARKET_ETL.md` and
asserts them against the real data, so a stale doc fails the build rather than
misleading a reader.

Asserted, because each is derivable from a file in the repo:

| Fact | Derived from |
|---|---|
| Species in catalog (1,080) | `marts/catalog.json` |
| Vendor count and every vendor name (8) | `etl/types.ts` `STORES` |
| Total listings (15,434) | `marts/market-index.json` sources |
| Species with price stats (299) | `marts/market-index.json` species |
| Portraits bundled (695) | `src/data/seed/assets/portraits/` |
| Species with a portrait (700) | `marts/catalog.json` |
| Inventory rows (61) | `fish_inventory.csv` |
| Curated care profiles (47) | `species-catalog.ts` |

**Not** asserted, deliberately: test count and bundle size. A test that counts
tests is self-referential and changes on every commit that adds one; bundle
size moves with every dependency bump. Both are removed from prose or stated
as approximate rather than guarded. Guarding a number nobody can keep correct
manufactures red builds and trains people to ignore the check.

The test follows the repo's own precedent — `species-catalog` already has a
test that fails if anyone adds a guessed species.

Wired into the existing `check` job in `.github/workflows/ci.yml`, which
already runs `npm test` on every push and PR. No new workflow.

---

## Acceptance criteria

1. `CLAUDE.md` exists at the repo root and states the spec-before-code rule,
   the branch flow, and the marts / literals / purity / no-invented-numbers
   conventions.
2. `docs/BACKLOG.md` exists with the three tables populated: every P1/P2 item
   currently in README prose, every post-PRD feature with a newly assigned ID,
   and any known bug.
3. `src/docs.test.ts` passes on the corrected docs, and **is demonstrated to
   fail** when a number in `README.md` is edited to a wrong value. A guard that
   cannot be shown to fail is not a guard.
4. `docs/MARKET_ETL.md` states eight vendors with correct listing counts, and
   `docs/RELEASING.md` points at `src/data/seed/marts/` and lists all five
   refresh stages including `portraits` and `marts`.
5. `npm test` and `npm run build` pass. CI green on the PR.
6. The README's "deliberately not built yet" list is replaced by a pointer to
   `docs/BACKLOG.md`, so the same list cannot exist in two places and diverge —
   the failure mode the Catalog screen was created to end.

---

## Alternatives rejected

**GitHub Issues as the tracker.** Notifications and triage machinery are real
benefits, and it is the conventional answer. Rejected because the spec and the
code would live in different systems and drift apart, which is the exact
failure being fixed; because every update needs network and a valid token, and
the token for this account had already expired once; and because the one
failure mode Issues solve best — losing track of open items — was the one
explicitly not selected.

**Generating the README's numbers from a template.** Makes drift structurally
impossible rather than merely detected, which is strictly stronger. Rejected
because the README's value is its prose argument, and prose written around
injected values reads badly and stops being directly editable. Detection is
sufficient here: the numbers change a few times a year, not daily.

**A scheduled or on-demand `/doc-audit` command instead of CI.** Catches prose
claims a test cannot, and costs no CI time. Rejected because it only works if
someone remembers to run it, which is the discipline problem restated rather
than solved.

**Blocking the gate on approval.** Maximum control, catches wrong direction
before any code exists. Rejected by direct decision: it costs a round-trip on
every change and would break the quick-feedback workflow that is how this
project actually gets built.

**Retro-writing specs for the five shipped-but-unspecced features.** Tempting
for symmetry. Rejected as archaeology: the commit bodies already carry the
reasoning at higher fidelity than a reconstruction would. They get IDs and
backlog rows, not invented specs.

---

## Risks

**The gate is only as strong as the agent honouring it.** Nothing mechanically
prevents code landing without a spec. A CI check could require a
`docs/specs/` file on any PR touching `src/`, but that punishes genuine
one-line fixes and invites empty specs written to satisfy it. Starting with the
convention; revisit if it is actually violated.

**Assertion brittleness.** A legitimate data refresh changes the listing count
and turns the docs test red. That is correct behaviour — a refresh *should*
force the docs to be updated — but it makes `npm run refresh` a two-step act.
`docs/RELEASING.md` must say so explicitly.

**A third place for status to live.** README, BACKLOG and PRD could disagree.
Mitigated by acceptance criterion 6: the README stops carrying the unbuilt list
and points at BACKLOG instead.
