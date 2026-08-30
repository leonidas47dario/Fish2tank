# 015 — Share a tank

## What was asked

> new feature I'd like you to work on. Each of my tank should have a Share icon
> which generates an URL that lets me share a read only view of my tank. Anyone
> should be able to review the page and see the exact same thing, and even
> favoriate fish into their dream list.

Refined across the brainstorm, in the asker's words:

> where would the content actually get hosted? would it be sustainable?

> yeah I feel like it wouldn't make sense to keep duplicating the images in the
> bucket while it already exists online. so I think the idea is to to a shared
> view that points to the images in the bucket instead, so kind of reverting
> previous snap shot idea.

> yup this should not only be a good way to share inventory, but also convert
> them into a user! so if they want to heart or see profile, they're be
> prompted to create an account and sign in.

## The problem

Two walls stand between a tank and a stranger looking at it, and both were
built on purpose.

**The gate.** Spec 010 wrapped the entire app in `AuthGate`, so nothing renders
without an account. That was right — a logged-out device silently accumulating
a collection it could not survive losing was the defect being fixed — but it
also means there is no such thing as a page a guest can open.

**The bucket.** Photos live at `users/{sub}/{blobKey}` in R2 and are reachable
only through a presigned URL the Worker issues after validating a Dexie Cloud
token bound to that subject. That one line in `worker/src/index.ts` is the
whole access-control model, and a guest has no token to present.

Neither wall is wrong. This spec cuts one door through both, and makes the door
narrow enough to describe in a paragraph.

## What a share is

One object in R2: `shared/{token}.json`. The token is `crypto.randomUUID()`.

The object holds both the frozen view of the tank *and* the list of photo keys
the link may read. One object, deliberately: revocation is then a single delete
with nothing left behind to garbage-collect, and there is no second file that
can rot out of step with the first.

The owner's account id is in that file and **is never sent to a guest**. The
Worker reads it to know whose prefix to serve from, and strips it from the
public projection. It is written from the *validated token* at publish time and
never from the request body — the same rule the Worker already applies to
photo keys, for the same reason.

### Why not the alternatives

| Considered | Rejected because |
|---|---|
| **Live view of the real tank** | A guest's browser cannot read a private Dexie Cloud realm. Serving it would need a server holding the owner's credentials: a real backend, a running cost, and a new place an entire collection can leak from. |
| **Dexie Cloud realm sharing** | Requires the guest to have an account, which is exactly what "anyone should be able to review the page" rules out. |
| **Everything in the URL fragment** | A tank's records would fit; photos would not. Text-only shares a tank with no fish in it. |
| **Copy the photos to a public prefix** | Duplicates bytes that already exist, as the asker pointed out. It also creates a second lifecycle to keep in step with deletes and the blob sweep. |
| **Publish downscaled derivatives** | A derivative is still a duplicate. Rejected on the same ground, with the cost recorded below rather than hidden. |

### The cost of pointing at originals, stated plainly

Nothing in this app downsamples; NFR-03 says the original is never silently
replaced, and `Media.previewBlobKey` and `thumbnailBlobKey` are declared and
unused. So the object a share points at is the untouched camera file. A real
one was measured at **3.6 MB** (spec 005).

A guest therefore downloads up to 3.6 MB per fish photo, lazily, as cards
scroll into view. That is the accepted price of not duplicating. R2 charges
nothing for egress, so the cost is the guest's time and not the owner's money.
If it proves too slow on a real phone, the fix is a preview derivative, and the
schema already has the slot for it.

## Hosting, and whether it is sustainable

Nothing new is provisioned. Three pieces already in the project:

- **The page** is the app itself. `main.tsx` uses `HashRouter`, so
  `.../Fish2tank/#/share/{token}` is served by GitHub Pages with no rewrite
  rules and no `404.html`. A side benefit worth naming: a fragment is never
  sent to a server, so the secret in the URL stays out of server logs and
  `Referer` headers.
- **The snapshot** is one object in the R2 buckets `wrangler.toml` already
  provisions, under a new `shared/` prefix.
- **The read** goes through the existing Worker. Not the `r2.dev` public URL,
  which Cloudflare rate-limits and documents as "for development purposes"; not
  a custom domain, which costs a domain.

| | Per shared tank | Free allowance | Headroom |
|---|---|---|---|
| R2 storage | a few KB | 10 GB/month | effectively unbounded |
| R2 Class B reads | 1 per view, plus 1 per photo | 10M/month | millions of views |
| R2 egress | 3.6 MB per photo viewed | **unmetered, $0** | none needed |
| Worker requests | 1 per view, 1 per photo | 100k/day | ~100k views/day |
| R2 Class A writes | 1 per publish | 1M/month | irrelevant |

The load-bearing fact is that **R2 never charges for egress**. The usual way a
share feature becomes expensive is a link landing somewhere busy and the
bandwidth bill arriving; here that bill is zero. The first thing to break under
absurd traffic is the Worker's 100k requests/day, and it breaks by failing
rather than by billing. Beyond the free tiers the rates are $0.36/million reads
and $0.015/GB-month, which stays inside the project's $10/month ceiling by
orders of magnitude.

**Bytes still do not pass through the Worker.** A media request is verified and
then answered with a 302 to a presigned R2 URL, so the browser fetches from R2
directly. The Worker's existing "bytes never pass through here" property is
preserved, and its 10 ms CPU budget is never near.

## Four Worker routes

| Route | Auth | Behaviour |
|---|---|---|
| `POST /shared` | owner's Dexie token | Writes `shared/{token}.json` with `owner` taken from the validated `sub`. HEADs the object back before reporting success. |
| `DELETE /shared/{token}` | owner's token, and the manifest's `owner` must equal the validated `sub` | Deletes it, then verifies it is gone. |
| `GET /shared/{token}` | none | Returns the public projection: the manifest minus `owner` and minus `allowedBlobKeys`. |
| `GET /shared/{token}/media/{blobKey}` | none | 404 for an unknown token. **403 for any key not named in the manifest.** Otherwise 302 to a presigned GET under `users/{owner}/`. |

The third and fourth routes are the first unauthenticated routes this Worker
has ever had, so the existing blanket `authenticate()` call at the top of
`fetch` has to become per-route. That is the highest-risk edit in this spec:
get it wrong and every photo route is public. It is covered by tests that
assert the *authenticated* routes still reject an anonymous caller.

## What is in the snapshot

An **explicit allowlist projection, never a record spread**. `Holding` is not
published: it carries notes and internal ids that nobody viewing a tank needs.

```
{ version, token, publishedAt, buildId,
  owner,             // stripped from the public projection
  allowedBlobKeys,   // stripped from the public projection
  tank:      { name, kind, volume?, photoBlobKey? },
  residents: [{ commonName, scientificName?, speciesId?, quantity, nickname?,
                adultSizeIn?, minVolumeGal?, aggression?, waterZone?,
                unitPrice?, photoBlobKey? }],
  stats:     TankStats }
```

`stats` ships **computed by the owner's device** rather than recomputed by the
guest. Two reasons: it guarantees the parity that was asked for, and estimated
value depends on the owner's own logged prices, which stay out of the published
file that way.

`allowedBlobKeys` is derived from the projection itself, not assembled
alongside it, so a photo key can never appear in the view without also being
permitted — and no key can be permitted that the view does not reference.

## Estimated value is public, on purpose

The tank view shows an estimated dollar value of the livestock. It was put to
the asker that a stranger with a link would see it, and the decision was to
show it, identical to the owner's view. Recorded here because it is a privacy
choice someone should be able to find and reverse later, not an oversight.

The tank photo often includes the room it is in. Same category, same reasoning.

## The funnel

Viewing is free. **Hearting a fish and opening its profile both prompt
sign-in.** The share page is the top of a funnel, not only a courtesy.

This deletes a whole subsystem that an earlier draft had: an anonymous local
dream list, held in the guest's browser and merged into a real account later.
Gating the heart means there is only ever one Dream List, the real one.

**The intent survives the sign-in.** Before `db.cloud.login()` is called, the
pending action (`{ action: 'heart', speciesId, returnTo }`) is written to
`localStorage`, because Google sign-in may return through a redirect that
discards memory. On return the share route replays it into the new account's
Dream List and confirms it on screen. Without this the funnel leaks at its last
step: a guest signs up, lands on an empty Home, and never finds the fish that
interested them.

## The refactor this needs

`TankDetail.tsx` is already the right screen — its own docstring describes the
viewer as the tank "you would show it to somebody standing in your living
room", where "nothing on it changes a record". But it reads from Dexie through
`useTankResidents`, so a guest cannot render it.

`TankViewer`, `StatRow`, `WaterColumn`, `Temperament`, `GrowsInto` and
`Coverage` move to `src/ui/components/tank/`, taking `residents` and `stats` as
props. The owner's live view and the guest's snapshot then render the identical
components. This is the only thing that keeps the two looking the same in six
months, and it is why the refactor is in scope rather than a copy being made.

## In scope

- `src/data/share/snapshot.ts` — the projection, and the key list derived from it.
- `src/data/share/publish.ts` — publish, revoke, and the local record of what is shared.
- `src/data/share/pending-intent.ts` — the action that survives a sign-in redirect.
- `worker/src/index.ts` — four routes, and per-route authentication.
- `src/ui/components/tank/*` — the presentational split described above.
- `src/ui/screens/SharedTank.tsx` — the guest view.
- `src/ui/components/ShareSheet.tsx` — the icon's panel.
- `src/App.tsx` — a public branch outside `AuthGate`.
- `src/ui/screens/Tanks.tsx` — the share icon on each tank card.

## Out of scope

- **Live updates.** The snapshot is frozen until republished, by decision.
- **Guest catalog browsing.** A guest sees the shared tank and nothing else.
- **Reporting hearts back to the owner.** It needs a write endpoint on a public
  link, which is an abuse and cost surface for a feature nobody asked for.
- **Downscaled derivatives**, per the cost note above.
- **A custom domain.**
- **A Settings list of every active share.** Each tank's own sheet reports its
  own state; a roll-up matters once there are many.

## Acceptance criteria

1. Every tank card carries a share icon that opens the sheet.
2. Publishing produces a URL, and the sheet then reports the tank as shared.
3. Opening that URL in a browser with **no account** renders the tank: name,
   stats including estimated value, water column, temperament, grows-into, and
   the residents with the owner's own photos.
4. The guest view is byte-identical in content to the owner's view of the same
   tank at publish time.
5. A guest tapping a heart, or a fish, is prompted to sign in.
6. After signing in, the guest lands back on the shared tank with the hearted
   species in their own Dream List.
7. Stop sharing makes the URL 404, and photo requests under that token 403.
8. A blob key not named in the manifest is refused even with a valid token.
9. Publish fails loudly if the object is not present afterwards.
10. The authenticated routes still reject an anonymous caller.

## Requirements claimed

- **FR-S01** A tank can be published as a read-only page at an unguessable URL.
- **FR-S02** The published page requires no account to view.
- **FR-S03** The page shows the tank as it stood when published, and does not
  change until republished.
- **FR-S04** Published photos are the existing objects, never copies.
- **FR-S05** A link is revocable, and revocation withdraws the photos too.
- **FR-S06** A guest hearting a fish is prompted to create an account, and the
  heart survives the sign-in.
- **FR-S07** A published file contains only fields named in an allowlist.
- **NFR-14** A public route serves only what a live manifest names. Access is
  derived from the manifest and the validated token, never from the request.

Touches FR-A03 (media), NFR-10 (short-lived signed URLs), NFR-12 (adapters),
NFR-13 (a run that cannot be read afterwards did not happen).
