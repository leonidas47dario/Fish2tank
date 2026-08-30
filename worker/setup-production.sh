#!/usr/bin/env bash
#
# One-time setup for the PRODUCTION media Worker.
#
# Why this exists: on 2026-08-30 every photo on production failed to sync -
# "0 up, 0 down, 28 failed" - and the cause was that this Worker had never been
# deployed. `wrangler deploy --env uat` had been run; `--env production` had
# not. The URL answered Cloudflare's own "error code: 1042" (nothing deployed
# here), so the app retried forever against nothing.
#
# Run from anywhere in the repo, after `npx wrangler login`:
#   bash worker/setup-production.sh
#
# Safe to re-run. A bucket that already exists is reported and skipped; a
# redeploy is just a redeploy. It sets NO secrets - those are prompted for
# separately so they never enter your shell history (step 5 prints the two
# commands).
set -euo pipefail
cd "$(dirname "$0")"

BUCKET=fish2tank-media-prod
WORKER_URL=https://fish2tank-media-prod.leonidas47dario.workers.dev

echo "==> 1/5  Who am I"
npx wrangler whoami

echo
echo "==> 2/5  R2 bucket '$BUCKET'"
npx wrangler r2 bucket create "$BUCKET" || echo "    (already exists, continuing)"

echo
echo "==> 3/5  Bucket CORS"
# The browser PUTs and GETs R2 directly on a signed URL, so the BUCKET needs
# its own CORS rules - the Worker's CORS headers do not cover those requests.
# Production's list is github.io only, matching ALLOWED_ORIGINS in
# wrangler.toml; r2-cors.json is the wider uat list and is not used here.
npx wrangler r2 bucket cors put "$BUCKET" --file r2-cors-production.json

echo
echo "==> 4/5  Deploy the Worker"
npx wrangler deploy --env production

echo
echo "==> 5/5  Verify something is actually answering"
# An unauthenticated POST should be REFUSED by our Worker (401), which is the
# proof it is there. 404 means the deploy did not land - and 404 is exactly
# what production was returning before this script existed, so this is the one
# check that distinguishes "deployed" from "believed deployed".
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WORKER_URL/presign/put" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://leonidas47dario.github.io' \
  -d '{"blobKey":"probe"}' || echo 000)

if [ "$status" = "401" ]; then
  echo "    OK - Worker is live (401 unauthenticated, as expected without a token)"
elif [ "$status" = "404" ]; then
  echo "    FAILED - still 404. Nothing is deployed at $WORKER_URL"
  exit 1
else
  echo "    Unexpected status $status from $WORKER_URL - check the deploy output above"
  exit 1
fi

cat <<'NEXT'

Two secrets still to set. Each prompts for the value, so nothing lands in your
shell history. They are the R2 API token's S3 credentials (Cloudflare
dashboard -> R2 -> Manage API tokens -> Create), NOT your account API token:

  npx wrangler secret put R2_ACCESS_KEY_ID     --env production
  npx wrangler secret put R2_SECRET_ACCESS_KEY --env production

Then open Settings on https://leonidas47dario.github.io/Fish2tank/ and sync.
NEXT
