# 059 — An origin we own

**Status:** direction approved, not built. The four decisions below were taken
on 2026-09-04 and are recorded in "The decisions, taken". No migration step has
been started.
**Date:** 2026-09-04. Decisions recorded the same day.
**Touches:** FR-R14, FR-A01, FR-A03, NFR-02, NFR-03, NFR-04.
**Introduces:** ENH-22.
**Related:** BUG-04 (which this would retire structurally), ENH-18 (which this
would make cheap), spec 005 (the environment contract this rewrites).

---

## What was asked

> What are some alternatives if I want to make my GitHub repo private and still
> be able to host it?

and, after the alternatives were laid out and contrasted:

> Let's design the spec for migrating to Cloudflare but don't do it yet

So this spec exists to be argued with before any of it is built. That is the
whole point of writing it now.

## The honest problem statement, which is not the one in the request

**If the only goal is a private repository, this spec should not be built.**

GitHub Pages publishes from a private repository on a GitHub Pro plan, at $4
a month. That path changes no origin, no base path, no database name, no share
link, and no CORS allowlist. It is one paid tier and one bug fix (see
"Prerequisite" below), and it is reversible by flipping the repository back to
public.

Migrating to Cloudflare is a **larger change than the request**, and pretending
otherwise is how the interesting part gets smuggled in. What it buys that Pro
cannot is one product capability and three pieces of retired debt:

1. **A UAT site behind a login.** GitHub Pages cannot gate a site below
   Enterprise Cloud, at any price. Cloudflare Access can. FR-R14 makes `/uat/`
   a review gate; today that gate is on the public internet.
2. **BUG-04 stops being worked around and starts being absent.** Cloudflare
   branch deployments give staging its own hostname, so the shared-origin
   IndexedDB collision that `databaseNameFor` exists to dodge cannot occur.
3. **The service-worker scope hack goes.** `vite.config.ts:17`'s
   `navigateFallbackDenylist` exists only because staging lives *underneath*
   production's path on one origin.
4. **CORS configuration goes** — *only with a custom domain*, which decision 2
   below declined. Site and Worker on one origin would remove `ALLOWED_ORIGINS`
   (twice), `r2-cors.json`, and `r2-cors-production.json`. On `*.pages.dev` the
   Worker stays cross-origin and **every one of those files survives the move**,
   pointing at new hostnames instead of being deleted.

That is the case. It is a real case, and it is not "make the repo private."
Whoever approves this should be approving *that*.

**As decided, item 4 is off the table and the case rests on items 1–3.** That
is a smaller case than the one this section opens with, and it is the one that
was actually approved. See "The decisions, taken".

## What this actually is: an origin migration

The host is the easy half. Every expensive consequence below follows from the
app moving to a **different origin**, not from Cloudflare specifically — the
same list would apply to Netlify, Vercel, or a VPS.

### 1. The environment contract breaks silently, in the worst direction

`src/data/environment.ts` decides which tier a build is by matching the Vite
base path:

```ts
export function deploymentFor(base: string): Deployment {
  if (base.endsWith('/uat/')) return 'staging';
  if (base === '/Fish2tank/') return 'production';
  return 'other';
}
```

Served from a root path, production returns `'other'`. Two things follow, and
both are in the module's own tests today:

- `cloudDatabaseUrlFor('/')` → `CLOUD_DATABASES.other`, the **throwaway**
  `z84eopr5r.dexie.cloud`. The docstring calls an unrecognised build reaching
  production "a genuine way to lose data"; this is the mirror image — the real
  collection routed to scratch.
- `mediaWorkerUrlFor('/')` → `''`, which turns **media sync off** and makes the
  UI report "not configured".

`src/data/environment.test.ts` asserts both as correct behaviour. They *are*
correct behaviour, for the design as written. This spec cannot simply delete
those assertions; it has to move the protection somewhere else (see "Design").

### 2. IndexedDB does not follow the app

`PRODUCTION_DB_NAME = 'fish2tank'` is scoped per origin. A new origin opens an
**empty database**. The same file already refuses to rename it, on the grounds
that doing so "would present an empty app to the person whose fish they are" —
and moving origin produces exactly that effect by a different route.

A signed-in keeper re-syncs the synced tables from Dexie Cloud. What does not
come back that way is `UNSYNCED_TABLES`: `blobs`, `deletedRecords`, `draftKeys`,
`species`, `speciesProfiles`. `species` and `speciesProfiles` re-seed from the
bundle, so they are fine. **`blobs` is the risk**, and NFR-03 makes it the
important one: a photograph captured but not yet flushed to R2 exists nowhere
else. BUG-10 and spec 045 already established that this class of loss is
refused rather than warned about; this migration must inherit that posture.

### 3. Every share link already sent out stops resolving

```ts
export function shareUrlFor(token: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const origin = typeof location === 'undefined' ? '' : location.origin;
  return `${origin}${base}#/share/${token}`;
}
```

`publishTank` deliberately reuses an existing token on republish, precisely so
that "the link a keeper has already sent out keeps working". Changing origin
breaks that guarantee for every link in someone's messages — a promise the code
goes out of its way to keep, broken by an infrastructure change.

### 4. Installed PWAs do not migrate

An installed home-screen app is bound to the origin it was installed from. It
keeps its own service worker and precache and will go on serving the old build
indefinitely. NFR-02 is about working offline; this is the failure mode where
offline works perfectly and shows the wrong app forever.

### 5. Five allowlists have to move in lockstep

`worker/wrangler.toml` (`[env.uat]` and `[env.production]`), `worker/r2-cors.json`,
`worker/r2-cors-production.json`, `worker/src/index.test.ts:17`, and the origin
whitelist inside Dexie Cloud Manager — which is not in this repository at all.
Any one lagging produces a 401 or a CORS failure that the app reports as a
retryable sync error, which is the exact reporting weakness spec 011 was written
about.

## Scope

**In:**

- Replacing path-derived environment detection with an explicit declaration.
- Cloudflare Pages projects for production and staging, with Access on staging.
- Migrating the five origin allowlists.
- A redirector that keeps existing share links alive.
- A rehearsed data-continuity check before production moves.

**Out:**

- Making the repository private. That is a separate, independent decision, and
  it is *not* a reason to do this. It can happen before, after, or never.
- ENH-18's share-link preview. This makes it cheap; it does not build it.
- Any change to what syncs (FR-A01) or to the Worker's authorisation model.
- A custom domain, and therefore the CORS removal and the ENH-18 simplification
  that depend on one. Declined in decision 2; revisitable later without
  redoing anything here, since a custom domain can be added to a Pages project
  after the fact.
- Making `/uat/` reachable by anyone but the repo owner (decision 3).

## Design

### The environment contract stops guessing

The base path stops being the signal. Each build declares its tier explicitly:

```ts
export function deploymentFor(declared: string | undefined): Deployment {
  if (declared === 'production' || declared === 'staging') return declared;
  return 'other';
}
```

fed from a `VITE_DEPLOYMENT` build variable set per Cloudflare Pages project.

**The safety property is preserved, not deleted.** "Unrecognised means
throwaway" survives verbatim — an absent, misspelled, or unknown value still
lands on the scratch cloud database and no Worker. What changes is that a tier
is now something a build *states* rather than something inferred from a URL
shape, which is what makes the same source serve from any path on any host.
The existing tests keep their intent and change only their inputs; the one
asserting production's database name has not moved stays exactly as it is.

### Hostnames

Per decision 2, `*.pages.dev` only — no custom domain.

| Tier | Host | Access |
|---|---|---|
| production | `<project>.pages.dev`, root path | public |
| staging | a distinct `*.pages.dev` hostname | Cloudflare Access, one seat |

Staging on its own hostname is what retires BUG-04 and the
`navigateFallbackDenylist` hack together: separate origins cannot share an
IndexedDB, and neither service worker's scope contains the other. That much
holds regardless of the domain decision.

**The one thing that must be verified before step 1, because the whole approved
case rests on it.** Decision 1 approved this migration *for* the gated UAT, and
decision 2 declined the custom domain that would put staging on a zone we
control. Cloudflare Pages does offer Access protection for non-production
deployments on `*.pages.dev`, but this has **not been verified here**, and the
exact shape matters: whether it covers a stable named branch alias (not only
per-commit preview URLs), and whether the protected hostname stays stable
enough to be the review gate FR-R14 requires — a URL that changes per
deployment is not a place you can send someone to review a build.

If it turns out Access cannot gate a stable `*.pages.dev` hostname, decisions 1
and 2 are in direct conflict and one of them has to give: buy the domain, or
stop, because items 2 and 3 alone do not justify an origin migration. **Verify
this first, before any project is created.**

### Order of operations, and why this order

The sequencing is the safety mechanism. Each step is reversible until the one
after it.

1. **Staging first, entirely.** New Pages project, `VITE_DEPLOYMENT=staging`,
   Access in front, staging's origin added to the uat Worker and uat bucket.
   Production is untouched and still on Pages throughout. Staging opening empty
   once is expected and harmless — it already happened once for BUG-04.
2. **Exercise the real failure modes on staging**, not a checklist: sign in,
   confirm the *staging* cloud database and *staging* Worker are in use (the
   Settings build panel already reports this), capture a photograph, confirm it
   reaches R2, publish a share link and open it in a private window.
3. **Only then, production.** Second Pages project, `VITE_DEPLOYMENT=production`,
   origin added to the prod Worker and prod bucket **before** the site goes
   live, verified by the same 401 probe `deploy-worker.yml` already uses.
4. **Pages becomes a redirector, and stays one.** `main` keeps deploying a
   minimal page at the old origin that forwards to the new one, preserving the
   fragment so `#/share/TOKEN` survives. This is permanent, not transitional:
   links already in people's messages have no expiry.
5. **Announce the reinstall.** Anyone with the app installed to a home screen
   must install it again from the new origin. There is no mechanism to do this
   for them, so it is a message, not a migration step.

### Data continuity, rehearsed rather than hoped for

Before production moves, and on production's real data:

- Confirm media sync reports nothing pending — the same condition spec 045 made
  sign-out refuse on. Unflushed `blobs` are the only genuinely unrecoverable
  thing here (NFR-03).
- Take a backup archive via the existing export path, so the pre-move state is
  recoverable independently of any of this.

## Acceptance criteria

1. `deploymentFor` returns `'other'` for an absent, empty, or unknown declared
   value, and a test asserts a build that fails to declare a tier can never
   reach the production cloud database.
2. `databaseNameFor` still returns `fish2tank` for production. Unchanged test.
3. Staging and production resolve to different origins, and a test or a built
   artifact check proves the two builds bake different cloud database URLs and
   different Worker URLs.
4. Staging is unreachable without authenticating; production is reachable
   without.
5. A photograph captured on the new production origin appears in the prod R2
   bucket, and one captured before the move is still readable after it.
6. A share link generated *before* the migration resolves to the correct tank
   after it, fragment intact.
7. An unauthenticated `POST /presign/put` against both Workers answers 401 from
   the new origin — the existing probe, run against the new allowlist.
8. `ALLOWED_ORIGINS`, both `r2-cors*.json` files, `worker/src/index.test.ts`,
   and the Dexie Cloud origin whitelist name the new origins, and a note in
   `docs/RELEASING.md` records that the Dexie one lives outside this repo.
   These files are **edited, not deleted** — decision 2 keeps the Worker
   cross-origin.
9. `docs/RELEASING.md`'s branch/URL table and its two "why" sections describe
   what is actually deployed, including the redirector.
10. Access challenges an unauthenticated request to the staging hostname, at a
    URL that is the same one on the next deployment. A gate you have to look up
    after every build is not a gate anyone will use.

## Alternatives rejected

**GitHub Pro, keep Pages.** Not rejected — *recommended*, if privacy is the
goal. It is rejected only as an answer to "we want a gated UAT and less
deploy machinery," which it cannot provide at any price below Enterprise.
These two options are not competing for the same job.

**Serve from Cloudflare at `/Fish2tank/` to avoid touching `environment.ts`.**
Rejected. It keeps a path named after a GitHub repository in a URL that is no
longer served by GitHub, preserves the shared-origin problem that BUG-04 and
the service-worker denylist both work around, and leaves the tier contract
matching on a string that now means nothing. It buys one untouched file at the
cost of every structural gain this spec is for.

**Migrate production first and let staging follow.** Rejected. It puts the
irreversible half first and tests the new origin on the only data that matters.

**Let the old links die.** Rejected. `publishTank` reuses tokens specifically
so already-sent links keep working; breaking them by infrastructure change
would silently withdraw a guarantee the code makes on purpose.

**Netlify or Vercel.** Rejected on integration, not quality: R2, the Worker,
and the media path are already Cloudflare, and a single origin shared with the
Worker is most of the CORS win.

## The decisions, taken

Put as four questions on 2026-09-04. Recorded with their consequences, because
two of them shrink this spec and one of them creates a dependency.

### 1. Migrate, and skip GitHub Pro

The gated UAT and the retired debt were judged worth it. **Repo visibility
becomes a separate decision, taken any time or never** — Cloudflare Pages builds
from a private repository on its free tier, so nothing here forces or blocks it.

The consequence worth naming: the question that started this
(*"make my repo private"*) is now **not answered by this spec at all**, and is
not scheduled. If privacy becomes urgent before this migration lands, GitHub Pro
is still the fast path and still costs $4.

### 2. `*.pages.dev`, no custom domain

Declines item 4 of the case above. The Worker stays cross-origin, so all five
allowlists survive the move rather than disappearing, and ENH-18 stays exactly
as expensive as it is today.

**This makes the approved case items 1–3 only:** a gated UAT, BUG-04 retired
structurally, and the service-worker denylist hack retired. That is a real but
noticeably smaller return than the section at the top of this spec describes,
and it is the one that was approved.

It also creates the verification dependency in "Hostnames" above: the gated UAT
is the *reason* for decision 1, and decision 2 removes the domain that would
most obviously deliver it. Check that Access can hold a stable `*.pages.dev`
hostname before creating anything.

A custom domain can be added to a Pages project later without redoing this
work, so this is a deferral rather than a foreclosure.

### 3. One person needs staging

The repo owner only. One Access seat, comfortably inside any free allowance, and
the identity question is trivial — an email one-time-pin or a Google login. No
seat-count verification needed, which removes one of the three unverified vendor
numbers below.

### 4. Fix the `deploy.yml` bug now, in its own PR

Taken as a separate change on its own branch, per `CLAUDE.md`'s one-PR-per-
feature rule. It is a latent bug today rather than a live one — decision 1 leaves
the repository public — but it is one line, it is certain to fire the moment
visibility changes, and it belongs to neither hosting option. Filed as BUG-19.

### What is still not decided

**When any of this gets built.** The direction is approved; no step has been
started, and step 1 should not begin until the Access-on-`pages.dev` question
above is answered.

## Numbers used here, and where they came from

**Measured** against this repository via the GitHub API on 2026-09-04:

- `deploy.yml`: 122 runs. `run_duration_ms` on the four most recent successful
  runs — 934,000 / 603,000 / 497,000 / 123,000 ms (15.6 / 10.1 / 8.3 / 2.1 min).
- All four report `billable.UBUNTU.total_ms: 0`, because a public repository is
  not billed. That zero is what would stop being zero.
- Ten `Deploy` runs on 2026-09-04 alone (run numbers 113–122, 03:33Z–13:29Z).
- `ci.yml`: 400 runs; two sampled at 62 s and 70 s.

**Quoted from vendor documentation and NOT verified here** — every one of these
must be checked against current pricing before it is relied on, because this
project has shipped a stated-as-fact estimate that was wrong by 3× before:

- GitHub Pro's monthly Actions allowance for private repositories (~3,000 min).
  **No longer load-bearing** — decision 1 leaves the repo public for now.
- Cloudflare Pages' free build allowance (~500 builds/month). Ten deploys in a
  day has been observed here, so this is worth checking rather than assuming.
- Cloudflare Access' free seat count (~50). **No longer load-bearing** —
  decision 3 needs one seat.

And one thing that is neither measured nor quoted, but **assumed and load-bearing**:
that Cloudflare Access can gate a stable `*.pages.dev` hostname. See "Hostnames".
It is the single assumption that, if wrong, invalidates the approved plan.

## Prerequisite, independent of this spec (BUG-19)

`.github/workflows/deploy.yml:41` tests for the `uat` branch with an
**unauthenticated** `git ls-remote`. On a private repository that call fails,
`exists` is set to `false`, and the assemble step publishes production alone —
**deleting `/uat/`**, silently, which is the failure the workflow's own header
comment warns against. It needs the token in the URL.

This is a live latent bug today and a certain one the moment the repository
goes private. It should be fixed on its own, under either option, and it is not
part of this migration.
