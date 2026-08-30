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

### The media Worker deploys separately, and has been forgotten before

The Pages build ships the app. It does **not** ship `worker/`, which is a
Cloudflare Worker with its own deploy per tier. On 2026-08-30 production had
been running for weeks with no Worker at all: every photo upload got
Cloudflare's `error code: 1042` and the app reported it as a retryable
failure. See `docs/specs/011-photo-sync-tells-the-truth.md`.

**Since spec 019 the Worker also serves shared tanks**, so a tier without one
deployed can neither sync photos nor share a tank. A redeploy is required for
sharing to work at all, because the four share routes are new code — a tier
still running the older Worker will 404 every publish. The share sheet reports
that rather than appearing broken, but it is still a deploy somebody has to
remember, which is what ENH-10 is about.

```bash
npx wrangler login
bash worker/setup-production.sh   # bucket, CORS, deploy, and verifies 401
```

The two R2 secrets are set separately, and are prompted for rather than passed
as arguments so they never reach your shell history:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID     --env production
npx wrangler secret put R2_SECRET_ACCESS_KEY --env production
```

To check either tier is alive without deploying anything, POST an
unauthenticated request and expect **401**. A 404 means nothing is deployed:

```bash
curl -si -X POST https://fish2tank-media-prod.leonidas47dario.workers.dev/presign/put \
  -H 'Content-Type: application/json' -H 'Origin: https://leonidas47dario.github.io' \
  -d '{"blobKey":"probe"}' | head -1
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
| `etl` | 12 vendors: ~50 paginated Shopify requests, plus ~280 PetSmart page reads and 8 Petco branch reads at 1/sec | ~10 min | `data/market/`, `src/data/seed/marts/market-index.json` |
| `images` | ~90 Wikimedia calls | ~1 min | `data/market/images.jsonl` |
| `warehouse` | none | seconds | `warehouse/dim/*.parquet`, `warehouse/fact/*.parquet` |

### Refreshing without hitting the vendors

```bash
npm run etl -- --offline
```

Rebuilds from the raw snapshots cached in `etl/raw/`. Use this whenever you
change normalization, matching or aggregation logic — there is no reason to
re-hit twelve vendors to test a parser change.

This matters more since the big-box vendors landed: PetSmart has no bulk feed,
so an online run reads 256 product pages and 8 store pages one at a time. That
is the permitted route (see [`MARKET_ETL.md`](MARKET_ETL.md)), and it is why
`--offline` is the default posture for anything that is not an intentional data
refresh.

`etl/raw/` is gitignored, so `--offline` needs one online run first on a fresh
clone.

### Politeness

These are small businesses' servers, and the two big-box ones will throttle
anything that behaves like a crawler. One shared client in
`etl/sources/http.ts` carries the manners for every source — a contactable
User-Agent, a wait between requests, `Retry-After` honoured, exponential
backoff on 429/5xx, capped pagination — so a new vendor reader cannot ship
without them. Do not raise the concurrency.

Permission is checked **per host, not per brand**. `www.petco.com` refuses
every automated request including its own `robots.txt`, so nothing is read from
it and no substitute for its prices is invented; `stores.petco.com` publishes a
`robots.txt` with no restrictions and is read. Same company, two answers.

### What a refresh should produce

A refresh is expected to change `market-index.json`, `catalog.json` and the
Parquet facts. It should **not** change any engine behaviour.

It **can** legitimately change the catalog's shape, and the 2026-08-29 refresh
did: vendors had grown their own catalogues, the species dimension went from
1,076 to 2,149, and the two build gates caught the consequences — 29 new naming
problems (`npm run marts` exits non-zero) and a water-zone coverage assertion
that had quietly become a marine-coverage assertion. Both were fixed at the
cause. That is the gates working, not the refresh failing; read a red build
after a refresh as a finding, not as noise to be silenced. If a refresh turns tests red, the
tests were asserting on live data rather than on logic — fix the test to derive
its expectation, as `market-scarcity.test.ts` does with the vendor count.

### On scheduling it later

Deliberately not scheduled yet. When it is worth doing, the shape is a
`workflow_dispatch` + `schedule` job that runs the three commands and opens a
**pull request** rather than committing to `uat` directly, so a vendor's
pricing change still gets reviewed. The `fact_listing` grain already includes
`snapshot_date`, so each accepted refresh appends a new day to the price
history rather than overwriting it.
