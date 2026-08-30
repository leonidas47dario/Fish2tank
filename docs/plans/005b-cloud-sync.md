# Cloud sync implementation plan (spec 005, Release 2)

**Status: partially built, blocked on credentials.**

Read this section before anything else in the file.

## The blocker, stated plainly

Release 2 cannot be finished by an agent working alone. It needs three
third-party accounts, and each one ties to Ryan's identity, his email, and in
Cloudflare's case a payment method. Creating accounts in someone's name on
external services is not a thing to do unilaterally, so this plan stops at the
boundary where credentials are required and does the work on the near side of
it.

What that means concretely: **nothing in this release makes data appear on a
second device yet.** The pieces that move bytes exist and are tested against a
fake backend. They have never spoken to a real one.

## What Ryan has to do (about 20 minutes, once)

1. **Cloudflare account** (free). Enable R2, create a bucket named
   `fish2tank-media`. R2 asks for a card on file even on the free tier; the
   first 10 GB and all egress are still free.
2. **Dexie Cloud database.** Run `npx dexie-cloud create`. It writes
   `dexie-cloud.key`, which contains a client secret and must never be
   committed. `.gitignore` already needs a line for it; this plan adds one.
3. **Google OAuth client.** A Google Cloud project, an OAuth 2.0 Web client,
   with `https://leonidas47dario.github.io` as an authorised origin.

Then hand over: the Dexie Cloud database URL, the R2 bucket name and an API
token, and the Google client ID. Secrets go into Worker environment bindings
and GitHub Actions secrets, never into the bundle (NFR-10).

**Sign in with Apple is deferred and should stay deferred.** It requires the
Apple Developer Program at **99 USD per year**, verified against Apple's own
enrolment page on 2026-08-29. That breaks the standing $0 ceiling for a second
sign-in button nobody has asked for twice. Google is free. Apple is purely
additive later if it ever earns its keep.

## Why the records half is not built

Spec 005 FR-A06 names the single largest risk: whether Dexie Cloud claims rows
created while logged out into the user's private realm on first login. If it
does not behave as documented, the 61-row inventory and the Panther either
duplicate or vanish.

That is an empirical question about a service this repo has never talked to.
Writing a detailed task list on top of an unverified assumption would be
planning theatre. So the records sync is deliberately absent here, and the
first task after credentials exist is not "wire up Dexie Cloud" but **"export
Ryan's real database and find out what first login actually does to it."**

## Why the media half *is* built

The media pipeline does not depend on Dexie Cloud at all. It depends on
presigned PUT, presigned GET, and HEAD for verification, which is the
S3-compatible contract R2 implements and which is not going to change out from
under us. The genuinely hard parts, retry, resume, ordering, and refusing to
call something synced until it is verified, are provider-independent and are
exactly where the bugs live. They are worth building and testing now.

---

## What shipped in this plan

### `src/data/sync/backend.ts`

The seam. A `MediaBackend` is three methods: `presignPut`, `presignGet`,
`head`. Everything above it is provider-agnostic, and the Cloudflare Worker
implementation slots in underneath without the queue changing.

Also defines `SyncEnvironment`, the identity block that every log line
carries: account, database URL, bucket, environment name. Wrong-tier writes
are invisible otherwise, which is the DW_SYNC lesson.

### `src/data/sync/media-queue.ts`

Upload and download orchestration.

- **`syncState` never advances on a 200 alone.** After an upload the object is
  HEADed and its size compared against what was sent. Mismatch leaves the item
  `retry-required` with a recorded reason rather than marking it clean. This
  is NFR-13, and it is the whole reason this module exists rather than a
  twenty-line fetch loop.
- **Priority order is thumbnail, preview, original**, so a new device is
  usable in seconds rather than after gigabytes.
- **Resume is the default.** An interrupted run leaves everything it had not
  verified in a retryable state; nothing is lost and nothing is double-marked.
- **Local originals are never deleted on successful upload.** NFR-03: the
  original is the record.

### `src/data/sync/sync-log.ts`

Structured logging that pairs intent with outcome. Every transfer logs both,
never just the attempt. Every run logs the session identity. Nothing is
swallowed.

### Tests

`media-queue.test.ts` drives the queue against an in-memory fake backend, and
covers the paths that matter: a corrupted upload that HEADs at the wrong size
must not be marked synced; an interrupted run must resume; an expired
signature must retry; a download must land bytes identical to what went up.

---

## The remaining tasks, for when credentials exist

Written as intentions rather than bite-sized steps on purpose, because the
first one can change the shape of the rest.

1. **Find out what Dexie Cloud actually does on first login.** Export a copy
   of Ryan's real database, point a scratch Dexie Cloud database at it, log
   in, and count every row before and after. Nothing else proceeds until this
   is answered with numbers.
2. **The Worker.** One route to broker Google identity into a Dexie Cloud
   token, one to mint presigned R2 URLs scoped to `users/{sub}/`. Secrets in
   bindings.
3. **Wire the real backend** into the existing `MediaBackend` seam.
4. **Turn on the addon** with `requireAuth: false`, `unsyncedTables` set per
   spec 005 FR-A01, and separate cloud databases for uat and production.
5. **Sync status in Settings**: last successful sync, pending count, failed
   items with reasons. Logs that cannot be read on a phone are not
   diagnostics.
6. **Fix BUG-04 first, with warning.** Separating the uat and production
   IndexedDB databases makes UAT open empty. Correct, necessary before sync,
   and alarming if unannounced.
