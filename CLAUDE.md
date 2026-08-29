# CLAUDE.md

Guidance for an agent picking this project up cold. Re-derives what previous
sessions worked out the hard way, so it doesn't have to happen again by
reading three files and one bug report.

## The gate: spec before code

Before writing code for anything beyond a typo or a one-line fix, write
`docs/specs/NNN-slug.md` first, in the same commit or earlier. It states:
what was asked (quoted verbatim), the problem behind it, what is in and out
of scope, acceptance criteria, alternatives rejected and why, and the FR/NFR
IDs it touches or the new ID it claims.

**Do not wait for approval to proceed.** The spec makes the reasoning
reviewable alongside the diff; it is not a checkpoint. Quick feedback still
becomes code in one session — what changes is that it cannot become code
without a written argument someone could disagree with.

See `docs/specs/001-requirements-discipline.md` for the full reasoning and
what was deliberately left out (GitHub Issues, a requirements index, blocking
approval).

## Conventions this repo has already paid for

- **Branch flow:** `feature branch → uat → main`. Every feature is its own PR
  into `uat`; `uat` is its own deployed site (`/uat/`) for review before a
  separate promotion PR into `main`. Never commit a feature straight to `uat`
  or `main`.
- **`src/data/seed/marts/*.json` is generated, never hand-edited.** It comes
  from `npm run marts`, which reads `warehouse/*.parquet`, which comes from
  `npm run etl && npm run warehouse`. Edit the ETL or the warehouse SQL, then
  regenerate — never patch the JSON.
- **`src/ui` contains no colour, radius, spacing or duration literal.**
  Everything comes from `src/theme/tokens.css`. A component that needs a
  token that doesn't exist yet adds the token, it doesn't hardcode a value.
- **Engines stay pure functions of `(stored inputs, versioned config)`.**
  `src/engine/**` never reads the clock, the network, or global state beyond
  its arguments — that's what makes the compatibility and rarity scores
  reproducible from a stored snapshot. Any exception needs a very good reason
  in the docstring, not just a comment.
- **Never invent a number.** Missing care data, an unmeasured tank, no market
  listings — all render as "not enough data," never a guessed value standing
  in as fact. This is a product principle (PRD, "P6"), not a style note.
- **Cite the FR/NFR ID in a code comment when implementing one.** It's how a
  future reader (or agent) finds out a line of code is load-bearing for a
  specific requirement rather than a guess.
- **Measure before asserting a number in a commit, PR, or doc.** Two defects
  this project actually shipped were an estimate stated as fact: a "27MB"
  portrait-budget estimate that was off by 3×, and a catalog described as
  "hundreds of fish" that was 47. Both were caught by someone asking "is that
  actually true?" — do that first.
- **One PR per feature**, even when several land in the same session. Don't
  bundle an unrelated fix into a feature PR because it's convenient.

## Where things live

- `docs/PRD.md` — the original 75 numbered FR/NFR requirements.
- `docs/BACKLOG.md` — bugs, unbuilt requirements, and everything built since
  the PRD that never got an ID. Read this before assuming something isn't
  tracked.
- `docs/specs/` — one file per non-trivial change, per the gate above.
- `docs/DATA_WAREHOUSE.md`, `docs/MARKET_ETL.md`, `docs/RELEASING.md`,
  `docs/INVENTORY_IMPORT.md` — subsystem docs. Known to drift from the code;
  check `docs/BACKLOG.md` for open doc-accuracy items before trusting a
  specific number in them.
