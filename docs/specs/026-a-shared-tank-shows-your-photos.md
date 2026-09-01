# 026 — A shared tank shows your photographs, not the catalog's

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** P3 (the exact specimen matters), FR-S01 (a tank published as a page), FR-J01 (the original is what is kept), NFR-04 (publication is the thing governed).
**Corrects:** spec 023, and a decision I made while merging it.

---

## What was asked

> Also noticed a bug where the shared page shows pic of the catalog's profile
> rather than my personal profile, I thought that was a requirement?

It was, and it is recorded in spec 023's own "What was asked", in the asker's
words, twice:

> Anyone should be able to review the page and see **the exact same thing**

> it wouldn't make sense to keep duplicating the images in the bucket while it
> already exists online. so I think the idea is to do a shared view that
> **points to the images in the bucket** instead

## This was a decision, not an accident

Spec 023 was written against a `uat` where a tank tile drew
`portraitAsset(speciesId)` unconditionally — nobody saw their own photographs
in a tank grid, the owner included. Spec 021 changed that for the owner while
023 was open, and the two met in a merge conflict inside the very join 023 had
extracted.

Resolving it, I made `loadTankResidents` report its photo choices separately
in `ownArt` and had the publisher ignore them, so a shared page kept drawing
stock portraits. I wrote that up as a deliberate decision, filed the
alternative as ENH-17, and said publishing a photograph of every fish was "a
different decision nobody has made."

**Somebody had made it.** The line was in the spec I was merging. The reasons I
gave — bytes, and the privacy of publishing every fish — were real
considerations, but they were considerations against a requirement that already
existed, and the right move was to raise them, not to quietly decide the other
way and file the requirement as an enhancement.

## The change

### The publisher names each fish's photo

`loadTankResidents` already decides WHICH photo a fish wears, using spec 021's
single precedence rule, so a guest sees the same face the owner does rather
than a second opinion about it. Publishing now:

1. Takes each `ownArt` entry and HEADs the object, exactly as the tank photo
   already does. A key is published only when the bytes are confirmed in R2,
   because a key the Worker cannot serve is a torn image on a stranger's
   screen — the bug report nobody files. Checks run in parallel; one HEAD per
   photographed fish in series would make publishing a well-photographed tank
   feel broken.
2. Warns, per publish, how many photos have not finished syncing, so the sheet
   can say why some fish still show a portrait.
3. Puts every published key in `allowedBlobKeys`, which is the Worker's
   membership check and therefore the security boundary. A key on the page but
   not in that list is a broken image; a key in the list the page never draws
   is an object published for nothing.

### The trap the fingerprint already documented, one field over

`fingerprintOf` carried a warning that the tank photo is keyed by its **media
id**, not its **blob key**, because a blob key is a *sync-state* answer: a tank
whose photo had not uploaded would read as changed on every tick, forever.

Putting `photoBlobKey` inside `snapshot.residents` — which the fingerprint
hashes — reintroduced exactly that bug one field over. The resident list is now
hashed without it, and the fish's media ids are hashed instead. `needsRepublish`
gains the per-fish analogue of the clause the tank photo already needed:
a photo that finishes uploading after a publish changes nothing about the tank,
so only a count of what was actually published can see it.

### The guest draws it

`asResident` prefers `${WORKER}/shared/:token/media/:key` when a key was
published, and falls back to the bundled portrait otherwise — the same order
`chooseArt` applies on the owner's screen, arrived at from the other end.

## The cost, stated rather than hidden

Each published key is an **untouched original**, measured at 3.6 MB in spec
005. A tank of twenty photographed fish is a large page.

Two things make that bearable and neither makes it cheap:

- Tiles are `loading="lazy"`, so a guest pays only for what scrolls into view.
  Verified in the browser, not assumed.
- R2 charges no egress, so it is the guest's time, not the keeper's money.

**FR-A08 — derived thumbnails and previews — is what would actually fix it, and
is still unbuilt.** Until it exists, this feature is correct and heavy. That is
the honest trade and it belongs in front of the keeper, not buried.

## What this does NOT change

- **Which photo.** Spec 021's precedence is untouched; one rule, three callers.
- **The identity gate.** A fish nobody has named still has no portrait to fall
  back to and still draws the placeholder.
- **What else is public.** No new field is published beyond the key, and the
  exact-key allowlist test still asserts the projection is a projection.

## Acceptance criteria

1. A resident with a synced photo publishes its key, and the key is in
   `allowedBlobKeys`. ✅
2. The tank photo and every fish photo coexist in that list, without
   duplicates. ✅
3. A fish with no published photo draws the bundled portrait. ✅
4. An unsynced photo does NOT change the fingerprint. ✅ (guarded, and the
   guard was proven by reintroducing the bug and watching it fail)
5. Gaining or swapping a photo DOES change the fingerprint. ✅
6. A photo that finishes uploading later triggers one republish. ✅
7. A guest draws the keeper's photo where there is one and the portrait where
   there is not, with no fish borrowing another's. ✅ (browser)
8. `vitest run` and `npm run build` both green. ✅
