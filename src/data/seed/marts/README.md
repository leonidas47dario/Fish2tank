# Generated marts — do not hand-edit

Everything in this directory is **build output**, rebuilt by the ETL. Edits
here are silently overwritten on the next refresh.

| File | Built by | From |
|---|---|---|
| `market-index.json` | `npm run etl` | normalized vendor listings |
| `catalog.json` | `npm run marts` | `warehouse/dim/dim_species` + `dim_image` |

Everything *else* under `src/data/seed/` is hand-maintained source:
`species-catalog.ts`, `fish_inventory.csv`, `assets/`.

That split is the whole convention: if it lives in `marts/`, a machine wrote
it; if it doesn't, a person did.

Rebuild everything with `npm run refresh`.
