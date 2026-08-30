# 005 - Accounts and cross-device sync

**Status:** designed, not built
**Date:** 2026-08-29
**Touches:** FR-O01 (private user workspace), NFR-04 (privacy), NFR-10 (authenticated, time-limited media URLs; no secrets in the bundle), NFR-12 (provider-neutral seams), PRD 12.1 (cloud/auth provider, left open).
**Claims:** FR-A01..FR-A07 (accounts and sync), NFR-13 (a sync is not complete until it is verified).
**Introduces:** a *data boundary* between personal records, regenerable ETL output, and media bytes, with a different destination for each.

---

## What was asked

Verbatim, so the interpretation stays auditable:

> "I want to redesign the user profile logic to retain data associated with
> accounts so I can login from phone, tablet, or computer... anywhere. I was
> thinking of logging in using username + password. but I know that we have no
> server, so what are the options?"

And on cost, when the first two answers turned out to conflict:

> "yeah for myself it should be free, otherwise under $10 per month is fine"

Decisions taken during design, each one Ryan's:

| Question | Answer |
|---|---|
| Who does this serve | Him now, other keepers later without a rewrite |
| What must appear on a second device | Everything, originals included |
| Budget | $0 for himself, under $10/month beyond that |
| Login method | Sign in with Google/Apple, not username + password |
| Privacy of the hosted copy | Private bucket and signed URLs; no end-to-end encryption |
| Architecture | Rent the sync engine, own the media pipeline |
| Reduced motion | Account-level, follows the person |
| Data boundary | "only sync personal, user generated data, and not ETL data" |

The username-and-password request was **withdrawn during design**, not
overridden. Presented with the true cost (owning password hashing, guess-rate
limiting, and a reset flow that needs an email sender), Ryan chose federated
sign-in instead. Recorded here because the original ask says otherwise and a
future reader will wonder.

## The problem behind it

Three separate problems wear one coat.

**1. There is no profile.** `User` and `UserSettings` are declared in
`src/domain/types.ts` and the `users` table is declared in `src/data/db.ts`,
and nothing in the codebase reads or writes either. Meanwhile the settings
people actually change live in `localStorage` under `fish2tank.settings`
(`src/theme/ThemeProvider.tsx`) in a *different shape*: it has `scene`, which
`UserSettings` lacks, and lacks `homeRegion`, `lengthUnit` and `volumeUnit`,
which appear nowhere else in the codebase at all. `currency` is hardcoded to
`'USD'` at `src/data/repositories.ts:339` rather than read from any setting,
which is a latent defect because `src/engine/pricing/price-fit.ts:171`
excludes price observations on currency mismatch.

So "redesign the user profile logic" is not a refactor of working code. It is
building the thing the types have been promising.

**2. Nothing leaves the device.** Every record and every original media byte
lives in IndexedDB. A second device starts empty, and a lost phone is a lost
collection. The `syncState` fields on `Media` and `Encounter` exist as a seam
for exactly this and have never been connected to anything.

**3. "No server" and "my data everywhere" cannot both be absolute.** Something
must hold the bytes while no device is holding them. What is negotiable is
whether that something is rented, already paid for, or another device.

## The measured constraint

Numbers measured in this repo on 2026-08-29, not estimated:

| Artifact | Size |
|---|---|
| `docs/the-panther-original.jpg` (a real original) | 3.6 MB |
| `src/data/seed/marts/catalog.json` | 1.6 MB |
| `src/data/seed/marts/market-index.json` | 2.2 MB |
| Seeded inventory | 61 rows (FR-O03) |

Personal records are kilobytes each and would sync anywhere for nothing.
Originals are megabytes each and are the only reason this costs money. Any
design that treats them the same is either too expensive or too small.

## Provider evidence

Checked against vendor documentation and pricing pages on 2026-08-29, because
free-tier terms move and the choice turns entirely on them.

| Provider | Free tier | Beyond free | Verdict |
|---|---|---|---|
| Cloudflare R2 | 10 GB storage, 1M Class A ops, 10M Class B ops per month, egress always $0 | $0.015/GB-month | **Chosen for media.** 10 GB is ~2,800 Panther-sized originals; $10 buys ~666 GB. Zero egress means a new device pulling the whole library costs nothing. |
| Dexie Cloud | 3 production users, 100 MB storage | €3/month per 25 seats, storage $0.05/GB | **Chosen for records.** Syncs the Dexie database this app already runs on. |
| Cloudflare Workers | 100k requests/day | $5/month | **Chosen for the auth broker and signed URLs.** |
| Supabase | 500 MB database, 1 GB storage | $25/month | **Rejected.** Free projects pause after 7 days of inactivity and need a manual dashboard unpause. An app opened on weekends would find a sleeping database. |
| Firebase | Auth is free and generous | Storage egress $0.12/GB | **Rejected.** Egress billing punishes exactly the operation this feature exists to perform: a new device downloading everything. |

## Design

### FR-A01 - The data boundary

Sync what is personal and irreplaceable. Never sync what the ETL can
regenerate. Never put megabytes where kilobytes are priced.

| Destination | Tables |
|---|---|
| **Dexie Cloud** | `users`, `specimens`, `encounters`, `holdings`, `residencies`, `aquariums`, `lifeEvents`, `memorials`, `identifications`, `priceObservations`, `raritySnapshots`, `dreamList`, `places`, `keeperPrinciples`, `cardPrefs`, `assessments`, and `media` metadata |
| **Cloudflare R2** | blob bytes only: originals, previews, thumbnails |
| **Neither (device-local)** | `blobs`, `draftKeys`, `species`, `speciesProfiles` |

Enforced with Dexie Cloud's `unsyncedTables` option.

`species` and `speciesProfiles` are excluded because they are seeded from
`marts/*.json`, which ships inside the bundle and is regenerated by
`npm run marts`. Syncing them would spend 3.8 MB of a 100 MB budget
replicating bytes already present on every device, and would let a stale
device push an outdated catalog over a fresh one. This matches the rule the
repo already applies to marts under merge: regenerate, never reconcile.

`draftKeys` is excluded because it exists to deduplicate retries on one device
(`src/data/db.ts`, FR-C07). Synced, one device's abandoned draft would
resurface on another.

`blobs` is excluded because it is the megabytes, and they go to R2.

### FR-A02 - Identity: the Worker as broker

One login, one identity, two consumers.

```
App  --Google/Apple Sign-In-->  ID token
  |
  '--> Worker /auth  --verify against provider JWKS-->  trusted `sub`
          |
          |--> exchange for a Dexie Cloud token (client_credentials + claims.sub)
          '--> issue a short-lived app session used for media requests
```

Dexie Cloud documents `fetchTokens` for precisely this, and it requires a
server side because the exchange needs a `client_secret` that must never ship
in a client bundle. A Worker is needed for R2 signed URLs regardless, so this
adds one route rather than a component.

This is what makes **NFR-10** true for the first time: secrets live in Worker
environment bindings, and every media URL is authenticated and time-limited.

Dexie Cloud reportedly added native Google/Apple sign-in in January 2026,
which could remove the token exchange. Treat that as a simplification to
evaluate during implementation, not a dependency: the broker is still required
for the Worker to know who is requesting a media URL.

### FR-A03 - Media transfer

`Media` rows sync as metadata. Bytes move on their own path, and that
separation is what makes the feature survivable.

- **Upload.** On capture the original lands in local `blobs` first, unchanged
  from today, so capture never blocks on the network. A queue then requests a
  presigned PUT from the Worker, uploads to `users/{sub}/{blobKey}`, verifies,
  and only then advances `syncState`.
- **Download.** A device missing a blob key requests a signed GET, streams it
  into local `blobs`, and caches it. `blobFor()` in `src/data/db.ts` already
  returns `undefined` for a missing blob and the UI already degrades to a
  placeholder, so "not downloaded yet" is an existing handled state, not a new
  failure mode.
- **Priority order:** thumbnails, then previews, then originals. A new tablet
  is usable in seconds and complete in the background.
- **NFR-03 holds.** Originals are uploaded byte-identical and never rewritten.
  Storing a copy elsewhere does not alter the original.

### FR-A04 - The profile record

One live `User` row, `id` set to the Dexie Cloud user id so it is stable
across devices, synced like any other personal record. Settings move out of
`localStorage` into it, which is what makes preferences follow the person
rather than only the data.

| Account-level (synced) | Device-level (stays in `localStorage`) |
|---|---|
| `themeId`, `sceneId`, `currency`, `displayName`, `reducedMotion` | `muted` |

`muted` is about the room a device is in. A tablet silenced in the living room
should not silence a phone at the fish store. `reducedMotion` is account-level
because it is an accessibility need belonging to the person, who should not
have to rediscover the setting on every device (NFR-06).

`homeRegion`, `lengthUnit` and `volumeUnit` are **deleted**, not carried.
They are unreferenced anywhere in the codebase, and migrating unused fields
into a synced schema means paying for them forever. `currency` is wired to the
setting, fixing the hardcoded `'USD'`.

### FR-A05 - An account is not a gate

Dexie Cloud is configured with `requireAuth: false`. The app must work
completely while logged out, exactly as it does today. Signing in is how you
*keep* your collection across devices, not how you are permitted to open it.
This preserves FR-O01 and PRD 2.2, which require the product to be private and
complete for one person.

### FR-A06 - Cutover, in two releases

The data is at risk here, so this ships as two releases, not one.

**Release 1, offline only.** Schema v3: reconcile `UserSettings`, create the
local `User` row, move `localStorage` settings into it. No cloud addon at all.
Ships to uat, gets verified, reaches main.

This ordering is mandatory, not cautious. Dexie's own documentation states
that migrations cannot be performed consistently on the client once a table is
synced. Every schema change must land before sync is switched on.

**Release 2, sync on.** The addon is enabled. On first login, Dexie Cloud is
expected to claim rows created while unauthenticated into the user's private
realm and push them up.

**That expectation is the single largest risk in this spec.** If it behaves
differently than documented, the 61-row inventory and the Panther either
duplicate or vanish. It is verified against an exported copy of the real
database before it is ever run against the real one. No exceptions.

**Media backfill** is a separate resumable job that walks local `blobs` and
uploads them, restartable from where it stopped, never deleting a local
original on success.

### FR-A07 - Multi-tenancy comes free

Dexie Cloud assigns every record to the creator's private realm by default,
with no configuration. Other keepers are isolated from each other without
anything being designed now, and realms are the documented path to sharing
later. Nothing in this spec builds for "others later" beyond not blocking it.

Per-user storage quotas are **out of scope** and noted for the backlog: with
originals syncing, a hundred keepers at a thousand photos each is a real bill
and a real abuse surface. It is not a problem at one user.

### NFR-13 - A sync is not complete until it is verified

A sync engine is the exact shape of the DW_SYNC failure: a status field
reporting success while the data sits somewhere else.

- **Never advance `syncState` on the strength of a 200.** After upload, HEAD
  the object and compare size and etag against what was sent. Verified, or it
  stays pending with a recorded reason.
- **Log intent and outcome as a pair**, per blob:
  `upload spec_x/orig 3.6MB -> ok 412ms` or `-> 403 signature expired`.
  Never the intent alone.
- **Log the session identity on every sync run:** account `sub`, Dexie Cloud
  database URL, R2 bucket, environment. Wrong-tier writes are otherwise
  invisible.
- **Never swallow an exception without logging it.** `ThemeProvider.tsx`
  currently has two `catch` blocks that explain themselves in a comment but
  log nothing. That is defensible for a cosmetic preference and stops being
  defensible once the same code path writes to a synced profile.
- **Surface it in the UI, not only the console.** Settings gains last
  successful sync, pending count, and failed items with reasons. Logs that
  cannot be read on a phone are not diagnostics.

## A pre-existing bug this uncovered

IndexedDB is scoped per origin, not per path. Both environments deploy to
`leonidas47dario.github.io`, so `/Fish2tank/` and `/Fish2tank/uat/` **already
share one IndexedDB database named `fish2tank` today**. A UAT build with a
schema bug can already corrupt production records, and once sync is enabled
that corruption would propagate to every device.

Dexie Cloud's `nameSuffix` option, on by default, appends part of the database
URL to the IndexedDB name, so pointing uat and prod at separate cloud
databases separates the local databases too. Worth fixing regardless of
whether this feature proceeds. Filed as a backlog item in its own right.

## Out of scope

- Username and password authentication, withdrawn during design.
- End-to-end encryption. Rejected in favour of private buckets and signed
  URLs, because federated sign-in provides no encryption key, a separate vault
  passphrase would make a forgotten passphrase an unrecoverable data loss, and
  E2EE blocks the sharing that FR-A07 leaves open.
- Sharing, invitations and realms beyond the default private one.
- Per-user storage quotas.
- Real-time collaborative editing.
- Any change to the ETL, warehouse, marts, or rarity and compatibility
  engines. This feature does not touch `src/engine/**`.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **All Cloudflare, custom sync** (Worker + D1 + R2) | Viable and marginally cheaper at large scale, but it means owning conflict resolution, tombstones, retry semantics and ordering. The sync engine is the riskiest code in the project and the one piece rentable for the price of a coffee. Media is the piece worth owning, because that is where the money and NFR-10 live. |
| **Supabase** | Free projects pause after 7 days of inactivity; $25/month to avoid it exceeds the stated ceiling. |
| **Firebase** | $0.12/GB egress bills the exact operation the feature exists to perform. |
| **Encrypted snapshot in a personal cloud drive** | Free and unlimited in practice, but no real accounts, OAuth per provider anyway, and whole-file last-writer-wins would silently lose edits made on two devices. |
| **Peer-to-peer sync between devices** | Requires two devices online simultaneously, which defeats "log in from anywhere" on a fresh device. |
| **Records and previews only, originals stay home** | Explicitly rejected by Ryan: originals must be present on every device. |

## Acceptance criteria

1. Signing in on a second device reproduces every personal record: specimens,
   encounters, holdings, tanks, residencies, life events, memorials, identity
   history, price observations, rarity snapshots, dream list and journal.
2. Every photo and video appears on the second device, originals included,
   with thumbnails visible before originals finish downloading.
3. An original downloaded on device B is byte-identical to the original
   captured on device A.
4. The app remains fully usable logged out, with no feature gated behind an
   account.
5. Theme, scene, currency and reduced motion follow the account; mute does
   not.
6. No `syncState` reaches a synced value without a post-upload verification
   of size and etag.
7. Every sync run logs account, database URL, bucket and environment, and
   every transfer logs both intent and outcome.
8. Settings shows last successful sync, pending count, and failed items with
   reasons.
9. Migrating a v2 database containing the seeded 61-row inventory and the
   Panther to v3 loses no row and no blob, verified by an automated test
   against a fixture.
10. `species`, `speciesProfiles`, `blobs` and `draftKeys` never appear in
    Dexie Cloud traffic.
11. uat and production do not share an IndexedDB database or an R2 prefix.
