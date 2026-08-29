# Data warehouse architecture

A star schema, materialized as Parquet, versioned in git, served to the app as
small precomputed JSON marts.

The design constraint is unusual and worth stating plainly: **the whole thing
is hosted on GitHub with no server, and it must move to a real warehouse later
without a rewrite.** Those two goals are compatible, but only if the storage
format and the model are chosen for the destination rather than for today's
host.

## Three layers

```
                    ┌──────────────────────────────────────┐
  EXTRACT           │ etl/sources/                         │
                    │   shopify.ts    8 storefronts        │
                    │   wikimedia.ts  licensed images      │
                    └──────────────────┬───────────────────┘
                                       │  raw JSON snapshots (gitignored)
                    ┌──────────────────▼───────────────────┐
  WAREHOUSE         │ warehouse/                           │
  star schema       │   dim_species  dim_store  dim_image  │
  Parquet           │   dim_date                           │
  ~MBs, git-tracked │   fact_listing  fact_price_observation│
                    └──────────────────┬───────────────────┘
                                       │  aggregate
                    ┌──────────────────▼───────────────────┐
  SERVING           │ src/data/seed/marts/*.json           │
  small, offline    │   market-index.json  catalog.json    │
  ~tens of KB       │                                      │
                    └──────────────────────────────────────┘
```

**Why the app never reads Parquet.** Querying Parquet in a browser means
DuckDB-WASM, which is tens of megabytes. This is an offline-first PWA on a
phone. The app gets precomputed JSON marts measured in tens of kilobytes; the
warehouse is for analysis, not for the hot path. Analysts point DuckDB at
`warehouse/` locally and write SQL against the same files.

## Why this migrates without a rewrite

Parquet plus a star schema is the lingua franca of analytics. Every destination
reads these files as they are:

| Destination | How |
|---|---|
| DuckDB (local) | `SELECT * FROM 'warehouse/fact/fact_listing.parquet'` |
| Athena / Trino | `CREATE EXTERNAL TABLE ... LOCATION 's3://…'` |
| BigQuery | external table over Parquet, or `bq load` |
| Snowflake | external stage + `COPY INTO` |
| Databricks | `CREATE TABLE ... USING parquet LOCATION` |
| Postgres | `parquet_fdw`, or COPY via DuckDB |

`warehouse/schema.sql` is the portable contract: plain DDL with keys, types and
comments. Migration is "copy the files, run the DDL, repoint the ETL's load
step". Nothing about GitHub hosting leaks into the model — no GitHub-specific
identifiers, no path assumptions inside the data, no reliance on git for
correctness.

## Grain, and why it matters most

The grain of the fact table is the single most consequential decision here.

**`fact_listing` — one row per (store, product, variant, snapshot_date).**

Snapshot-date in the grain is what turns a re-run into real history. Today a
listing's price is frozen at whatever the store published; there is no price
history API and no Wayback coverage. But once every run appends rows stamped
with its snapshot date, the warehouse accumulates a genuine time series:

```sql
-- What did a jaguar cichlid at 6in cost, over time, per store?
SELECT snapshot_date, store_key, median(price)
FROM fact_listing f JOIN dim_species s USING (species_key)
WHERE s.scientific_name = 'Parachromis managuensis' AND size_band_in = 6
GROUP BY 1, 2 ORDER BY 1;
```

That query returns one row today and a real trend line in six months, without
any schema change. This is the reason to build a warehouse rather than keep
overwriting a JSON file.

**`fact_price_observation` — one row per price the user personally recorded.**
Separate from listings on purpose: what Ryan saw on a tag in Chicago is a
different kind of fact from what a mail-order store published, and pooling them
would destroy the distinction the app's price engine depends on.

## Dimensions

| Table | Grain | Notes |
|---|---|---|
| `dim_species` | one row per species | Type 2 SCD on name changes, so a re-identification does not rewrite history |
| `dim_store` | one row per vendor | currency lives here; pooling prices across currencies is only valid because of it |
| `dim_image` | one row per image | source, license, artist, URL — a 图鉴 image without attribution is not usable |
| `dim_date` | one row per day | conventional, makes time-series joins trivial in any destination |

Surrogate keys (`*_key`) are stable hashes of the natural key, not
autoincrements, so the same row rebuilt on a different machine gets the same
key and git diffs stay small.

## What git gives us, and what it does not

**Gives us:** free versioning of every warehouse build, reviewable diffs on the
marts, and a rollback path. A bad ETL run is `git revert`.

**Does not give us:** row-level mutation, concurrent writes, or efficient
storage of very large facts. Parquet files are rewritten whole on each build.

That is fine at the current scale — thousands of listings, single-digit MB —
and the ceiling is roughly a few hundred MB before git gets unpleasant. The
migration trigger is that size, or the first time two people need to write
concurrently. Neither is close.

## Rebuilding

```bash
npm run etl              # extract → warehouse → marts
npm run etl -- --offline # rebuild from cached raw snapshots
npm run warehouse:query  # open a DuckDB shell over warehouse/
```
