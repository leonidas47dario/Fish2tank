# 066 — Borrow a credential that works

## What was asked

> Can you deploy UAT worker using prod environment?

After the uat Worker deploy failed and the run history showed the uat token has
never worked.

## Why this is not just a convenience

`deploy-worker.yml` wired two different questions to one input:

```yaml
environment: ${{ inputs.environment }}      # which SECRETS
run: wrangler deploy --env ${{ inputs.environment }}   # which WORKER
```

So a tier could only ever be deployed with its own credentials. That is the
right default and it was the only option, which is a different thing.

**The uat token has never deployed anything.** Every run this workflow has had:

```
failure   uat    2026-09-10   ← the spec 054 deploy
success   main   2026-09-01
failure   main   2026-09-01
failure   main   2026-09-01
failure   main   2026-09-01
```

One success, on production, after three failures. So the uat failure is not a
credential going stale — it is a credential that was never proven, failing its
first real trial. Cloudflare returned `Authentication error [code: 10000]`, which
is generic, and wrangler's own hint was *"ensure it has the correct permissions
for this operation"*. The `/accounts` call failed too, which points at a token
that is invalid or malformed rather than merely under-scoped.

Waiting on a credential nobody has debugged, in order to ship a route that is
already merged and already tested, is a worse outcome than borrowing one that
demonstrably works.

## Why borrowing is possible at all

One Cloudflare account. `wrangler.toml` carries the same `R2_ACCOUNT_ID` for
`[env.uat]` and `[env.production]`, so a token with Workers Scripts:Edit on that
account can deploy either Worker. The tiers are separated by Worker name and by
bucket, not by account.

## The asymmetry, which is the whole safety argument

**Downward is fine. Upward is not.**

| Target | Credentials | |
|---|---|---|
| uat | production | **allowed** — a stronger credential at a lower-stakes tier |
| uat | uat | the default |
| production | production | the default |
| production | uat | **refused** |

Borrowing production's token to deploy uat still attaches the **production**
GitHub Environment, so it still passes through production's required reviewer.
Nothing happens without a human saying yes. That is the point rather than a side
effect.

Borrowing upward would be the inverse: a uat deploy needs no approval, so
letting uat's token deploy production would route a production deploy around the
approval that gates it. That is a privilege escalation wearing a convenience
flag, and the workflow refuses it explicitly rather than relying on nobody
choosing it.

## Scope

**In:** a second `credentials` input, defaulting to `same`; the refusal above;
the guard step's message naming both environments so a failure says which token
it looked for.

**Out:**

- **Fixing the uat token.** That is a credential in a GitHub Environment and
  cannot be done from here. This makes it non-blocking, not fixed.
- **Deploying production.** Unchanged, and still gated on its own reviewer.
- **Making any deploy automatic.** The workflow's opening comment argues for
  manual dispatch and that argument is untouched.

## Acceptance criteria

1. `credentials: same` (the default) behaves exactly as before.
2. `environment: uat, credentials: production` deploys the **uat** Worker —
   `wrangler deploy --env uat`, the uat bucket, the uat database URL — using
   production's token, and pauses for production's reviewer first.
3. `environment: production, credentials: uat` fails before wrangler runs, with
   a message saying why.
4. The existing 401 probe still gates success, against the host matching
   `inputs.environment` rather than the credentials.

## Alternatives rejected

**Copy production's token into the uat environment.** Fewer moving parts, and
it is what a person would do by hand. Rejected because it puts a
production-capable credential in an environment with no reviewer — exactly the
escalation the refusal above exists to prevent — and it hides the borrowing
rather than recording it in the run.

**Wait for the uat token to be fixed.** The honest default, and what should
happen eventually. Rejected as a blocker: the route is merged, tested and
inert, and the thing standing in its way is a secret nobody has looked at yet.

**Deploy the uat Worker by hand with wrangler.** How the uat Worker got there
in the first place — and the opening comment of this very workflow calls that
out as the failure it exists to stop: *"the uat Worker was deployed from a
feature branch during spec 023 and nobody recorded it, which is how a tier ends
up running code no one can name."*

## Requirements touched

- **ENH-10** — deploy the Worker from CI rather than from someone's memory.
- **NFR-14** — the Worker's public surface; unchanged, but this is what lets
  spec 054's third route actually reach a tier.
