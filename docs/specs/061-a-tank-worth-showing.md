# 061 — A tank worth showing

**Introduces:** ENH-24.

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

### Blocker 1 — CORRECTED: it was never three users

**This section was wrong, and the correction came from Ryan looking at the
running app:**

> I saw we are already having and supporting multiple users right now. Why do
> you think that they only support three users? I do not think that is true …
> I saw we can already log in from Google for different users.

He is right, and the app proves it. The original text quoted spec 005's vendor
table — "3 production users" — and treated that as the number of people who can
use this app. It is not. Re-checked against Dexie Cloud's own pricing and
access-control documentation on 2026-09-13:

| | free tier |
|---|---|
| **Evaluation users** | **50,000**, with user management and authentication |
| **Production users** | 3 (€0.12/user/month beyond, sold in packs of 25) |
| **Demo users** | unlimited, and they never expire |

So signing in as a fourth, fifth or five-thousandth person works exactly as
observed. Those are **evaluation users**, and they sync.

**The limit is real but deferred, and its shape is worse than a wall.** An
evaluation user gets **30 active days** — inactive days are not counted, so a
weekend keeper takes months to spend them. When they run out:

> "After an evaluation period ends, the user can continue using the app but
> won't be able to sync data."

Nothing is deleted. Local records and offline use are untouched. **Syncing
stops, quietly.** Upgrading is a manual act in the Dexie Cloud management app or
a REST call, or an automated payment integration nobody has built.

**There is a live consequence today, independent of any social feature.** Every
account signed in for testing is on that clock, and the only place the app says
so is one line in the account panel:

```
Account licence is {license}. Records are safe on this device but are not syncing.
```

`AccountPanel.tsx:250`. That is correct, and it is a small grey line in a
settings screen — not where a keeper would learn that their records stopped
leaving the device. **Filed as BUG-23.**

So the honest version of this blocker: accounts are not the problem, and the
feature does not cost money at its first real user. It costs money at the first
user who **stays past thirty active days**, which is a different and much later
question — and the app should say so out loud before then.

### Blocker 2 — REFINED: realms do most of this; a directory does not exist

Also overstated. Dexie Cloud has **realms**: "access controlled partition[s] of
data", with a `members` table, per-table `add` / `update` / `manage`
permissions, and object ownership that survives them. One user really can share
a set of objects with another named user, invited **by email**, and the
recipient accepts — which the documentation is explicit is deliberate, because
"it protects other users from unwillingly starting to see new data."

Spec 023 rejected realms for a *shared tank*, correctly: a stranger reviewing a
public page cannot be made to hold an account. **A friends list is the opposite
case.** Both parties have accounts by definition, so the objection does not
transfer, and it was sloppy to carry it across.

What realms plausibly do, with no new backend:

- add a friend, accept, see a friend list — that is the invite flow verbatim
- see a friend's tanks, fish, timelines, memorials — objects in a shared realm
- like and comment — rows in a realm both parties can write to

What realms do **not** do, and this is the real gap:

- **a global directory.** Nothing in the access-control model queries across the
  database for users. You can *invite* a known email address; you cannot *search*
  to find out whether one exists.
- so **"search users by email"** as a lookup, and **"discover users near me"**,
  both need a server that holds a queryable index of people — with everything
  that implies about consent, because a directory of aquarium keepers with
  approximate locations is a different privacy object from a tank photo.

That server is still a real piece of work. It is now the blocker for *discovery*
rather than for the whole feature.

**Neither blocker is a reason not to do this**, and after the correction above
neither is as large as this spec first claimed. They belong at the top rather
than discovered in week three — but the first draft put them there with a number
that did not survive being checked against the running app, which is its own
lesson: "measure before asserting" applies to a vendor's pricing page as much as
to a portrait count.

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
