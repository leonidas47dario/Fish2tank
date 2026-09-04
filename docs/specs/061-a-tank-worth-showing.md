# 061 — A tank worth showing

**Status: specified, not built.** Written on request, ahead of any decision to
build it. Nothing in this document has been implemented.

## What was asked

> a social media functionality: allow user to add friends, see what others
> posted, like their posts and leave comments (interact), search user by emails,
> see friend list name, discover users near me etc, user profile board etc. you
> can mirror how fish brain did it with catching fish

## Why this one is different from every spec before it

Every feature this project has shipped runs on the keeper's own device.
IndexedDB holds the records, Dexie Cloud syncs them between that person's own
devices, and the one thing that ever leaves — a shared tank — is a static
snapshot published to R2 behind a token, read by strangers who never write
anything back.

**A social network is the opposite shape.** It is other people's data on your
screen, written by them, changing without you. Nothing in the current
architecture does that, and no amount of care with the existing pieces gets
there. So this spec's most useful section is not the feature list; it is the two
things that have to be true first.

### Blocker 1 — the account tier cannot hold a second user

From spec 005's own vendor table, the free Dexie Cloud tier is:

> 3 production users, 10 databases, 100 MB storage split 25 MB object + 75 MB
> blob

**Three users.** Spec 023 already ran into the adjacent limit — it rejected
Dexie Cloud realm sharing for shared tanks because "the recipient must accept an
invitation and authenticate, so they need an account — exactly what 'anyone
should be able to review the page' rules out. The free tier is 3 production
seats." A friends list is that same wall with more people behind it.

This is not a matter of writing the feature carefully. **A social feature costs
money from its first real user**, and how much is a question this spec cannot
answer because it depends on a pricing decision nobody has made. Dexie Cloud is
€0.12/user/month at the published rate; a hundred keepers is €12/month, which is
small, and a hundred thousand is not.

### Blocker 2 — there is no server that holds anyone else's records

The Worker (`worker/src/index.ts`) does exactly one job: it hands out
short-lived presigned URLs for R2 objects, plus two token-scoped public reads
for a shared tank. It holds no database, has no write route a client can call
with content, and deliberately returns 404 for `/presign/delete`.

A feed needs the opposite: durable rows, written by many accounts, queried by
relationship. That is a real backend — a database, an authorisation model, and
somebody on the hook when it leaks.

**Neither blocker is a reason not to do this.** They are the reason it is a
project rather than a feature, and they belong at the top rather than discovered
in week three.

## What "mirror Fish Brain" actually maps onto

Fish Brain's unit is a catch: a species, a photograph, a place, a time. This app
already has that object and calls it an **encounter**, with `specimens`,
`media`, `places` and `identifications` around it. It also has three things Fish
Brain does not, and they are the more interesting posts:

| Fish Brain | Fish2Tank equivalent | Already exists |
|---|---|---|
| A catch | An encounter — species, photo, place, date | yes |
| — | **A tank**, its stocking and its dashboard | yes (spec 023 publishes one) |
| — | **A fish's timeline** — acquired, grown, measured, photographed | yes (spec 037) |
| — | **A memorial** — a fish that died, and its whole life | yes (spec 046) |
| Personal best | Largest measurement recorded for a species | yes (spec 038) |

The honest read: **this app's best posts are not catches.** A keeper who has
photographed the same fish across two years, recorded its growth, and finally
written its memorial has something no fishing app can show. Mirroring Fish Brain
literally would put the weakest of these — a single photo of a fish in a shop —
at the centre.

## Scope

### Phase 1 — a profile worth visiting (no social graph yet)

The public half of what was asked, buildable on the **existing** Worker + R2 +
token mechanism, with no new backend and no per-user cost.

- **A profile board**: a keeper's public page — display name, the species they
  keep, their tanks, their longest-kept fish, their memorials. Built from the
  same projection `publishTank` already uses, with the same allowlist discipline.
- **A shareable profile link**, exactly as a shared tank works today.
- **`users.displayName` becomes user-facing.** It exists (`domain/types.ts`) and
  is currently only ever read locally.

This phase is genuinely additive and carries no unanswered privacy question,
because publishing stays an explicit act by the owner about their own data —
which is what spec 023 and spec 026 already settled.

### Phase 2 — the social graph (needs the blockers answered)

- Add a friend, accept a request, see a friend list.
- A feed of friends' posts: new fish, new photographs, measurements, memorials.
- Like a post; comment on a post.
- **Search by email**, with the constraint below.

### Phase 3 — discovery

- Suggested keepers, by species kept or by tank type.
- **"Near me"**, with the constraint below.

### Out of scope, deliberately

- **Direct messages.** A different product with a different moderation burden.
- **Public comments from strangers.** Phase 2 comments are friends-only. An open
  comment box is a moderation commitment nobody has signed up for.
- **Follower counts, streaks, leaderboards.** FR-L03 already forbids the
  memorial screen being "a stats-heavy reward screen", and the same instinct
  applies here: a hobby where a mistake kills an animal should not reward
  posting volume.

## The two requests that need a decision before they need code

### "Search user by emails"

An email lookup that answers is an **enumeration oracle**: anyone can test
whether a given address belongs to a keeper, and a leaked address list becomes a
membership list. The mitigations are known and none is free:

- Match only on a **hash** of the normalised address, so the server never holds
  the plaintext.
- Return a result only when the address matches **exactly** — never a prefix,
  never a suggestion.
- **Opt in.** A keeper who has not enabled "findable by email" is not found, and
  the response is identical to a genuine miss so the difference is unobservable.
- Rate-limit per account, because the protection above is worthless against a
  script with a wordlist.

### "Discover users near me"

The sharpest item in the request, and the one this project has already taken a
position on. `PlacePrivacy` in `domain/types.ts` carries the comment:

> NFR-04 / 8.2: exact store and home locations stay private.

That rule was written about *shops*. It applies with far more force to a person.
A keeper's tank is in their home, so "keepers near me" is, unavoidably, an
approximate map of where strangers live.

If it is built at all, the shape that does not contradict NFR-04 is:

- **Coarse only** — a city or a region, never a coordinate, never a radius small
  enough to narrow to a street. `private-coarse` already exists as a concept.
- **Opt in**, off by default, and revocable without deleting the account.
- **Never derived from a photograph.** NFR-04 requires EXIF stripping on shared
  derivatives and **the app currently strips none** (ENH-18 records this). A
  location feature that reads EXIF would be inferring a home address from a
  picture the keeper did not know contained one.

**That last point is a prerequisite, not a footnote.** EXIF stripping should
land before any location feature, and arguably before Phase 1, because a
published profile means more photographs leaving the device.

## Acceptance criteria

Phase 1 only; later phases get their own spec once the blockers are answered.

1. A keeper can publish a profile page and revoke it, using the same token
   mechanism and the same revocation guarantees as a shared tank (spec 028: a
   `shares` row is never destroyed while the page it names is live).
2. The published profile contains only what the projection allowlists — asserted
   by a test, in the same shape as the shared-tank projection tests.
3. Erasing everything takes a published profile down, or aborts (spec 028).
4. A profile with nothing on it renders as an invitation, not as an empty grid.
5. No new per-user cost: Phase 1 adds no Dexie Cloud seats and no Worker state.

## Alternatives rejected

**Build the feed on Dexie Cloud realms.** The mechanism exists and would avoid a
new backend. Rejected on the same ground spec 023 rejected it: every participant
needs an account on a three-seat tier, and realm sharing is designed for a
person's own collaborators rather than for a public feed.

**Federate, or publish to an existing network.** Posting to somewhere that
already has the users avoids all of this. Rejected as a different product: the
ask is for friends *inside* the app, and the posts are records this app holds.

**Do the social graph first and the profile later.** The profile is the half
that works on today's architecture and it is what a friend would look at anyway.
Building the graph first means paying both blockers before anything is visible.

## Requirements touched

- **NFR-04 / 8.2** — location privacy, and the unfixed EXIF gap that a location
  feature would make reachable.
- **FR-L03** — a gentle, dignified tone rather than a stats-heavy reward screen.
- **P6, never invent a number** — a profile shows what is recorded and says
  "not enough data" everywhere else, exactly as every other screen does.
- **New IDs claimed:** FR-S01 (profile board), FR-S02 (friends), FR-S03 (feed),
  FR-S04 (interactions), FR-S05 (email search), FR-S06 (proximity discovery).
