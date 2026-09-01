# 024 — Deploy the Worker from CI, not from someone's memory

**Status:** implemented (the workflow); blocked on one GitHub constraint before it can run — see "When this becomes usable".
**Date:** 2026-09-01.
**Touches:** ENH-10 (the backlog row this closes), NFR-14 (the Worker's public surface), FR-A03 (media sync depends on the Worker existing).
**Follows:** spec 011, which diagnosed the outage this prevents.

---

## What was asked

> What credentials do you need for the workers? Is there a GitHub secretes
> feature etc I can safely store it so you have it in the future

Asked while the share feature appeared to be blocked on a Worker deploy nobody
could run. It turned out not to be blocked (see "What this is not"), which
makes this the right time to build it rather than the wrong one: nothing is
waiting on it, so it can be got right.

## The problem is a class, not an incident

Spec 011 recorded the incident. Production reported "0 up, 0 down, 28 failed"
on every photo, and the cause was that `wrangler deploy --env production` had
never been run — `--env uat` had. The URL answered Cloudflare's own
`error code: 1042`, and the app reported that permanent 404 as a retryable
failure, so it retried forever while the screen promised it would work out.

`worker/setup-production.sh` closed the incident. It did not close the class,
and its own header says so: a deploy whose trigger is a person remembering will
drift again.

**It already has.** While preparing this, `GET /shared/<token>` on the uat
Worker answered `{"error":"no such share"}` — a string that exists only in the
Worker code spec 023 added, and is absent from `main`. So somebody deployed the
uat Worker from a feature branch at some point during that work, and there is
no record of it anywhere: not a commit, not a run, not a line in a doc. That is
the same class as the outage, wearing the opposite outcome. A tier is running
code nobody can name, and it happened to be the right code.

## What this is not

**It is not the fix for a blocked UAT review.** Two earlier claims in this
session were wrong and are corrected here so the next reader does not inherit
them:

1. "The share sheet will say sharing is unavailable" — false on UAT.
   `shareBlocker()` returns `not-configured` only when the Worker URL is unset,
   and on a deployed tier it is set. The button is live.
2. "The uat Worker lacks the share routes" — false, and the result of probing
   `/share/` when the route is `/shared/`. The correct path answers
   `no such share`, which is the new code.

Both were stated with more confidence than the evidence supported. The probe in
the workflow exists partly because of this: a claim about what is deployed
should come from asking the deployed thing.

## The credential, and where it lives

One token. `wrangler deploy` needs **Account → Workers Scripts → Edit** and
nothing else; **Account → Workers R2 Storage → Edit** is needed only if CI is
ever to create buckets or set CORS the way `setup-production.sh` does by hand,
which this workflow deliberately does not.

Three things are deliberately NOT stored as secrets:

- **The account id.** Already committed in `worker/wrangler.toml` as
  `R2_ACCOUNT_ID` — an R2 account id is the Cloudflare account id. It is not a
  secret in Cloudflare's model, and `wrangler.toml` carries no top-level
  `account_id`, so the workflow reads it out of the file. Stored twice is
  stored wrong: one copy can drift from the other.
- **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.** These are Worker secrets set
  with `wrangler secret put`. They live on the Worker and a redeploy does not
  disturb them. The workflow does not carry them and must not: putting them in
  GitHub would create a second copy of a credential that already has a home.
- **Anything in a chat transcript.** The token was offered directly and
  declined. A credential in a transcript is a credential in a log, and this
  session's container is reclaimed after inactivity, so it would have bought
  about an hour of convenience for a durable exposure.

The token goes in a **GitHub Environment** rather than a plain repo secret,
because an Environment is also where the approval gate lives: `production` has
required reviewers, so a production Worker deploy stops and waits for a human,
matching the promotion PR that already gates production's site. `uat` has no
reviewers, so it can be deployed on demand.

## Decisions

### Manual, not on push

A Worker deploy changes a live tier for every device at once. There is no
`/uat/` equivalent for the Worker — no staging copy of staging — so the review
gate that makes site deploys safe does not exist here. Automating it on push to
`uat` would mean every merge silently reconfigures a live backend.

So the trigger stays a decision. What this removes is the laptop, the
`wrangler login`, and the possibility of running the command for one tier and
believing you ran it for both.

### The probe is the deliverable, not the deploy

`wrangler deploy` reporting success is what everyone believed last time. The
job therefore fails unless the deployed Worker answers **401** to an
unauthenticated `POST /presign/put` — proof that our code is there and
refusing, rather than Cloudflare's 404 or its plain-text `1042`.

A second probe reports whether `/shared/` answers `no such share`, which the
401 cannot tell you: it says *which* code is live, not merely that some is.
That one warns rather than fails, because deploying an older ref on purpose is
legitimate and should not be blocked by a check about a newer feature.

### Alternatives rejected

- **A push-triggered deploy on `uat`.** Rejected above: no staging for staging.
- **Storing the account id as a secret.** It is not secret, and a second copy
  can drift from `wrangler.toml`.
- **Letting CI run `setup-production.sh`.** It creates buckets and writes CORS,
  which needs a broader token for a job that should be rare and deliberate. The
  script stays the tool for standing a tier up; this workflow only redeploys
  one that exists.
- **Pinning an exact wrangler version now.** Nobody here has run wrangler, so
  any exact version would be a guess stated as fact. Pinned to major, with
  `--version` printed, so the first green run supplies the number worth
  pinning.

## When this becomes usable

**GitHub resolves `workflow_dispatch` against the default branch.** A workflow
file that exists only on `uat` or on a feature branch has no Run button and
cannot be dispatched through the API. So this cannot run until it reaches
`main`.

That leaves two routes, and the choice belongs to the repo owner:

1. **Normal flow.** Merge to `uat`, and it becomes dispatchable at the next
   promotion. Costs nothing, breaks no convention, and is the recommended one
   because nothing is waiting on it.
2. **A separate PR into `main`.** Faster, but `main` would then hold a file
   `uat` does not — and the promotion applies uat's tree wholesale, so the next
   promotion would DELETE it. The `deploy-to-main` skill's step-1 tree check
   catches exactly this and would refuse to proceed, which is the safety net
   working, but it is a landmine to leave lying about. If this route is taken,
   the same file must land on `uat` as well.

## Acceptance criteria

1. A `workflow_dispatch` workflow exists that deploys either tier's Worker. ✅
2. The token is read from a GitHub Environment secret, never from the repo. ✅
3. `production` requires a human approval; `uat` does not. ✅ (via the
   Environment's protection rules, configured outside the repo)
4. The account id is read from `wrangler.toml`, not stored a second time. ✅
5. The job FAILS when the deployed Worker does not answer 401 — the state that
   was previously reported as success. ✅
6. The run reports which code is live, without failing on an old one. ✅
7. Not yet met, and cannot be from here: **one green run against `uat`**, which
   requires the workflow to be on `main` first. Until that happens this spec is
   a design nobody has executed, and it should not be described as working.

---

## What the first run taught (2026-09-01)

The first dispatch against `production` failed, and the *interesting* part was
not the error.

```
ERROR  In a non-interactive environment, it's necessary to set a
       CLOUDFLARE_API_TOKEN environment variable
```

That reads as a missing secret. The real signal was that **the run never
paused for approval** - which it must, because `production` was configured
with required reviewers. Both symptoms have one cause: the job's environment
was never attached.

**GitHub does not fail when a job references an environment that does not
exist. It creates an empty one** - no secrets, no protection rules - and runs.
So a name that does not match does not produce "no such environment"; it
produces an ungated deploy that fails three steps later blaming wrangler.

`production` is a different environment from `PROD` or `Production`.

A preflight step now checks the token before wrangler runs and says exactly
this, naming the environment the job asked for. Spec 024 already argued that
"the probe is the deliverable, not the deploy" - this is the same argument one
step earlier: a deploy that cannot work should say why, not let the next tool
guess.

**The absence of an approval prompt is now documented as a diagnostic**, not
just a convenience. If a production run does not stop for a human, its
protection rules are not attached, whatever the settings page appears to say.
