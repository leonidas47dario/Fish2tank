# Releasing and refreshing

Two things happen on a cadence here, and they are deliberately separate:
shipping **code**, and refreshing **data**. Conflating them means a vendor
adding a product can change what production shows without anyone reviewing it.

---

## Branches and environments

```
feature branch  ──▶  uat  ──▶  main
                     │          │
                     ▼          ▼
              /Fish2tank/uat/  /Fish2tank/
                 staging        production
```

| Branch | URL | Purpose |
|---|---|---|
| `uat` | https://leonidas47dario.github.io/Fish2tank/uat/ | Every change lands here first and is exercised live |
| `main` | https://leonidas47dario.github.io/Fish2tank/ | Production. Only ever receives merges from `uat` |

**Nothing goes to production without having been live on `/uat/` first.**

### Why both come from one workflow

GitHub Pages serves one site per repository. `.github/workflows/deploy.yml`
therefore checks out *both* branches, builds each with its own base path, and
publishes a single artifact containing `/` and `/uat/`.

The consequence worth knowing: **a push to either branch rebuilds both.** The
Pages artifact is published whole, so publishing only half of it would delete
the other environment. It also means production is rebuilt from `main` even
when you only pushed to `uat` — which is harmless and idempotent, but explains
why a staging push shows production steps in the log.

### The service-worker trap this design creates

Staging lives *underneath* production's path, so production's service worker
has a scope that contains `/uat/`. Left alone, anyone who visited production
first would get production's cached shell served for every staging navigation,
and staging would silently show the wrong build.

`vite.config.ts` handles it: the production build adds `/uat/` to its
`navigateFallbackDenylist`, and staging installs under a different name
(`Fish2Tank (UAT)`) so an installed staging build cannot be mistaken for
production on a home screen. If you ever move staging to its own host, both of
those become unnecessary.

### Promoting

```bash
git checkout uat && git pull
# verify at /Fish2tank/uat/
git checkout main && git pull
git merge --no-ff uat
git push          # deploy runs, production updates
```

---

## Refreshing the data

The pipelines are re-runnable by design and **not scheduled** — a refresh is a
deliberate act that produces a reviewable diff.

```bash
npm run etl        # 1. vendors  → data/market/ + market-index.json
npm run images     # 2. portraits → data/market/images.jsonl
npm run warehouse  # 3. star schema → warehouse/*.parquet
```

Run them in that order: the warehouse reads what the first two write.

| Stage | Network | Runtime | Writes |
|---|---|---|---|
| `etl` | 8 vendors, ~25 paginated requests | ~1 min | `data/market/`, `src/data/seed/market/market-index.json` |
| `images` | ~90 Wikimedia calls | ~1 min | `data/market/images.jsonl` |
| `warehouse` | none | seconds | `warehouse/dim/*.parquet`, `warehouse/fact/*.parquet` |

### Refreshing without hitting the vendors

```bash
npm run etl -- --offline
```

Rebuilds from the raw snapshots cached in `etl/raw/`. Use this whenever you
change normalization, matching or aggregation logic — there is no reason to
re-hit eight small businesses to test a parser change.

`etl/raw/` is gitignored, so `--offline` needs one online run first on a fresh
clone.

### Politeness

These are small businesses' servers. The client identifies itself with a
contactable User-Agent, waits between page requests, honours `Retry-After`,
backs off on 429/5xx, and caps pagination so a bug cannot become a hammering
loop. Do not raise the concurrency.

### What a refresh should produce

A refresh is expected to change `market-index.json` and the Parquet facts. It
should **not** change any engine behaviour. If a refresh turns tests red, the
tests were asserting on live data rather than on logic — fix the test to derive
its expectation, as `market-scarcity.test.ts` does with the vendor count.

### On scheduling it later

Deliberately not scheduled yet. When it is worth doing, the shape is a
`workflow_dispatch` + `schedule` job that runs the three commands and opens a
**pull request** rather than committing to `uat` directly, so a vendor's
pricing change still gets reviewed. The `fact_listing` grain already includes
`snapshot_date`, so each accepted refresh appends a new day to the price
history rather than overwriting it.
