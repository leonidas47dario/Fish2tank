# 011 — Photo sync tells the truth, and production gets its Worker

## What was asked

> the same bug which happened to UAT is happening to prod, can u take a look?
> I wasn't able to sync photos

and, on being shown the diagnosis:

> Please prioritize this fix, much more important
>
> I see, it's possible that we never set up the worker for production

and then:

> Is that something you can set up for me? Is there a safe way I can give you
> the key id and access key?

## The problem

Production's Settings panel reported **"0 up, 0 down, 28 failed"** and offered
a retry. Every retry failed identically, and would have failed identically
forever, because there was nothing to talk to: the media Worker had been
deployed with `wrangler deploy --env uat` and never with `--env production`.

Measured rather than assumed. A `POST /presign/put` with the real production
origin returns:

| Environment | Response |
|---|---|
| uat | `401 {"error":"unauthenticated"}` — our Worker, refusing an unauthenticated call |
| production | `404 error code: 1042` — Cloudflare's own plain-text "no Worker here", no CORS headers |

The 1042 is the tell. It is not our 404; it is the workers.dev subdomain
saying nothing is deployed on it.

Two separate defects fall out of that, and both are in scope:

1. **A missing deployment.** Purely operational, but it is the actual outage.
2. **A screen that said the opposite of the truth.** `TransferSummary` carried
   counts and nothing else, so the UI could say "28 failed" and then guess at
   the rest — and its guess was "they will be retried". A permanent
   configuration fault was presented as a transient one. That is the worse
   half: the outage would have been diagnosed in a minute if the screen had
   said what it knew.

It was also confirmed that no code was missing from production. Every file
under `src/data/sync/`, `src/ui/**` media path and `worker/` is byte-identical
between `origin/main` and `origin/uat` — so this was never an unshipped patch,
which was the first hypothesis and was wrong.

## In scope

- `WorkerCallError`, carrying the HTTP status and route, with
  `isConfiguration` true for 404/401/403 — the statuses no amount of waiting
  fixes.
- `TransferSummary.firstError` and `.configurationFault`, so the summary
  carries a diagnosis and not only a tally. The **first** failure's reason is
  kept, not the last: twenty-eight failures with one cause are one problem,
  and the first is the one not yet coloured by its own aftermath.
- `AccountPanel` distinguishing the two cases in words a person can act on,
  with the verbatim error printed small and last for whoever is debugging.
- `worker/setup-production.sh` — an idempotent, re-runnable script that
  creates the bucket, applies production's CORS rules, deploys `--env
  production`, and then **verifies** the endpoint answers 401 rather than
  trusting the deploy output.
- `worker/r2-cors-production.json` — production's bucket CORS, github.io only,
  matching `ALLOWED_ORIGINS` in `wrangler.toml`. `r2-cors.json` keeps the
  wider list (localhost included) for uat.

## Out of scope

- **Claude running the deployment.** It cannot: `wrangler whoami` reports no
  authentication in this environment and no `CLOUDFLARE_API_TOKEN` is set.
- **Accepting the R2 key ID and secret access key in chat.** Refused on
  purpose. The conversation transcript is written to disk and persists, so a
  credential pasted into it outlives the task. `wrangler secret put` prompts
  for the value and keeps it out of shell history too, which makes the owner
  running two commands strictly safer than any hand-off — so that is the
  recommended route, not a fallback.
- Automatic re-deployment of the Worker from CI. Worth doing (a Worker whose
  deployment is a person's memory will drift again) but it is a separate
  change with its own credential questions; see the backlog.

## Acceptance criteria

1. A media run against an undeployed or misconfigured Worker reports
   `configurationFault: true` and a `firstError` naming the status.
2. Settings says retrying will not help, and says the photos are safe on the
   device — because they are; NFR-03 has never deleted a local original.
3. A retryable failure still reads as retryable. The new wording must not
   turn every failure into "give up".
4. `bash worker/setup-production.sh` on an authenticated machine leaves the
   production endpoint answering 401, and exits non-zero if it does not.
5. Re-running the script changes nothing and still exits 0.

## Alternatives rejected

- **Show the raw error and let the reader work it out.** `"/presign/put
  failed: 404 Not Found"` is a diagnosis to whoever wrote the Worker and noise
  to everyone else. The status is kept as structured data precisely so the UI
  can make the judgement rather than delegating it to the person holding the
  phone.
- **Treat any failure as permanent once the count is high enough.** Tempting
  and wrong: a flaky network produces exactly the same count, and telling
  someone their photos need a deployment when they need a better signal is a
  new lie replacing the old one. The status is the evidence, not the tally.
- **Keep the last error instead of the first.** See above — the last failure
  is the most likely to be an artefact of the earlier ones.
- **Hand the credentials over and deploy it here.** Rejected on the transcript
  -persistence ground above, independently of whether the environment could.

## Requirements touched

- FR-A03 (media sync), NFR-13 (a run that cannot be diagnosed afterwards is
  not a run that happened), NFR-03 (the local original is the record).
