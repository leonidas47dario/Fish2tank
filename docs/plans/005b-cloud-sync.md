# Cloud sync implementation plan (spec 005, Release 2)

**Status (2026-08-30): unblocked. Provisioned, and the largest risk is
measured and clear.**

Read this section before anything else in the file.

## What changed

This plan previously stopped at a credentials boundary and refused to write
the records-sync tasks on top of an unverified assumption. Both conditions are
gone.

**Provisioning is done.** Ryan created everything on 2026-08-29 and 30. Three
Dexie Cloud databases, deliberately not two, because uat and production deploy
to the same origin and therefore share one IndexedDB namespace (BUG-04):

| Database | Role |
|---|---|
| `https://z84eopr5r.dexie.cloud` | scratch |
| `https://zblsiza99.dexie.cloud` | uat |
| `https://zecprrllc.dexie.cloud` | production |

All three have Google configured in Dexie Cloud Manager and their app origins
whitelisted. Cloudflare R2 is enabled on account
`4c73038eafb05b96ed7125aeeca9cfff` with `fish2tank-media-uat` and
`fish2tank-media-prod`, both private.

**Task 1 is answered, with numbers.** 138 real rows, loaded logged-out, still
138 after login, and 138 confirmed by an independent server-side export, all
owned by the logged-in user. See spec 005 FR-A06 for the full census. The
harness is in `probe/`.

**No secret reaches this repo or an agent.** The Google client secret lives in
Dexie Cloud Manager; the R2 keys go into Worker bindings by hand. That is what
the FR-A02 rewrite bought.

**Sign in with Apple is deferred and should stay deferred.** It requires the
Apple Developer Program at **99 USD per year**, verified against Apple's own
enrolment page on 2026-08-29. That breaks the standing $0 ceiling for a second
sign-in button nobody has asked for twice. Google is free. Apple is purely
additive later if it ever earns its keep.

**Sign in with Apple is deferred and should stay deferred.** It requires the
Apple Developer Program at **99 USD per year**, verified against Apple's own
enrolment page on 2026-08-29. That breaks the standing $0 ceiling for a second
sign-in button nobody has asked for twice. Google is free. Apple is purely
additive later if it ever earns its keep.

## Why the records half was not built, and why it can be now

Spec 005 FR-A06 named the single largest risk: whether Dexie Cloud claims rows
created while logged out into the user's private realm on first login. Writing
a detailed task list on top of an unverified assumption would have been
planning theatre, so the records sync was deliberately absent.

It has now been measured against the real 138-row database and it behaves as
documented, including the FR-A01 data boundary, which held with no special
handling. The tasks below can therefore be written as actual steps.

One operational detail found while doing it: **demo users must be declared
server-side before `grant_type: 'demo'` works.** An undeclared demo login
returns `403` from `/token` and the login promise never settles. Declare them
with a JSON file and `npx dexie-cloud import`:

```json
{ "demoUsers": { "probe@demo.local": {} } }
```

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

## The remaining tasks

In dependency order. Task 1 is struck through because it is done; it is left
here so the sequence still reads.

1. ~~**Find out what Dexie Cloud actually does on first login.**~~ Done
   2026-08-30. 138 rows in, 138 rows out, 138 on the server, all correctly
   owned. Harness in `probe/`.

2. **Fix BUG-04, with a warning to Ryan before it ships.** Separate the uat and
   production IndexedDB databases. This must land before sync, because Dexie's
   own documentation says migrations cannot be performed consistently once a
   table is synced. It makes UAT open empty: correct, necessary, and alarming
   if unannounced.

3. **Turn on the addon.** `requireAuth: false` so the app stays usable logged
   out (FR-A05), `unsyncedTables` exactly as FR-A01 lists, and a different
   database URL per environment. `Fish2TankDB` now takes addons as a
   constructor argument, which is the only source change the probe needed.

4. **Sign-in UI.** A single "Sign in with Google" affordance calling
   `db.cloud.login({ provider: 'google' })`. No callback route, no custom GUI
   unless the addon's default proves unusable.

5. **The Worker.** One concern only now, not two: presigned R2 PUT/GET scoped
   to `users/{userId}/`, with callers authenticated by validating their Dexie
   Cloud access token against `GET /token/validate`. Cache validations for the
   token lifetime; there is no JWKS to verify offline.

6. **Wire the real backend** into the existing `MediaBackend` seam. The queue,
   its retry and resume behaviour, and its refusal to mark anything synced
   without a post-upload HEAD are already built and tested against a fake.

7. **Sync status in Settings**: last successful sync, pending count, failed
   items with reasons. Logs that cannot be read on a phone are not
   diagnostics.

**Not in this plan, but a prerequisite for FR-A03's priority ordering to mean
anything:** nothing generates thumbnails or previews, so there is currently
only one variant to transfer. Tracked in the backlog.
