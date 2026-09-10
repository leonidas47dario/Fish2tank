# 054 — A shared tank should preview as the tank

**Status:** **proposed, not built.** Queued deliberately; see "What was asked".
**Date:** 2026-09-04.
**Touches:** FR-S01, FR-S05, FR-S07, NFR-04, NFR-14.
**Backlog:** ENH-18.

---

## What was asked

> When I share a tank, can you make the preview be the tank's profile?

With a screenshot of an iMessage rendering a shared tank as a **blank card** — a
generic compass glyph, the words "Fish2Tank", and `leonidas47dario.github.io`.
No tank name, no photograph.

And, when the cost was put to the keeper:

> That can be a new feature spec to be Qed up, no need to build right now

So this spec exists to be reviewable and decided-upon, not to be implemented in
the session that wrote it.

## Why it is blank, precisely

Three things have to be true for a rich preview, and today none of them is.

**1. The token is in a fragment, on purpose.** `shareUrlFor` returns
`…/Fish2tank/#/share/<token>`, and `client.ts` says why in a comment: *"A
fragment, so the token never reaches a server log."* **A fragment is never sent
to any server.** An unfurler asking for that link requests
`/Fish2tank/` and nothing else — so nothing it reaches can possibly know which
tank is being previewed.

**2. GitHub Pages is static.** Even if the token were in the path, Pages serves
files. There is no request-time hook that could write `og:title` for tank 47.

**3. Unfurlers do not run JavaScript.** The app resolves the fragment and
fetches the snapshot, but that happens in a browser. iMessage's preview
fetcher, Slack's, and every link scanner see the raw HTML only.

A generic card — one Open Graph block in `index.html` naming the app — would
fix the *ugliness* and is a two-line change. It cannot fix the *ask*, which is
that the preview be **this tank**.

## The proposal

Serve the preview from the Worker, which is the one part of this system that
executes per request.

**A third public GET route**, beside the two that already exist
(`/shared/:token` and `/shared/:token/media/:blobKey`):

```
GET /p/:token   →   text/html
```

It reads the same manifest those routes read, and returns a small document:

| tag | from |
|---|---|
| `og:title` | the tank's name |
| `og:description` | the snapshot's own counts — "24 fish · 15 species" |
| `og:image` | an absolute URL to the **existing** `/shared/:token/media/:key` route, for the tank photo the manifest already allows |
| `og:url` | itself |

…plus a redirect onward to `…/#/share/<token>` so a person who taps it lands in
the app exactly as they do today.

`shareUrlFor` then returns the Worker URL instead of the Pages one.

**Nothing new is stored and no new secret is needed.** Every value above is
already in the published manifest, and the image route is already public and
already allowlisted per token — spec 023 built it so a stranger's browser could
draw the page.

## What it costs, stated before it is built

**An unfurler learns the token.** Today it receives the whole URL in the message
body but never *sends* the fragment, so it learns nothing by fetching. After
this, fetching the preview is fetching the token, and anything that unfurls the
link — a messaging service, a link scanner, a corporate proxy — can then read
the snapshot.

**But the stated privacy property is already weaker than it sounds**, and this
is the part worth arguing about rather than assuming. The Worker logs the token
on every snapshot read:

```ts
const identity = { env: env.ENVIRONMENT, bucket: env.R2_BUCKET, token, route };
console.info('[worker] share read -> ok', identity);
```

So the token reaches a server log the moment **anyone** opens the link — the app
puts it there itself. The fragment protects it from GitHub's access logs, not
from ours. The honest framing of the trade is therefore *"a machine that unfurls
links now reads your tank automatically, where before it could have but did
not"*, and not *"the token becomes logged for the first time"*.

**NFR-04 is inherited, unsolved.** It requires stripping EXIF from shared
derivatives; the app strips none, and stored originals may carry home GPS. That
is already true of the images on a shared page, and a preview widens who fetches
them from "people you sent the link to" to "every machine that sees the link".
Whether that changes the answer is a decision, not a detail.

## Open questions for whoever builds it

1. **Does the preview need auth-free image access it does not already have?**
   Believed no — `/shared/:token/media/:key` is public by design. Worth
   confirming against `permits()` before relying on it.
2. **What does a revoked share preview as?** The manifest is gone, so the route
   404s. A 404 unfurls as nothing, which is probably right, but it should be a
   decision.
3. **Does moving the canonical URL break links already sent?** It must not.
   `#/share/:token` has to keep working forever — people have already sent
   those. This is additive, never a replacement.
4. **Is one og:image enough**, or should a tank with no photo fall back to
   something rather than previewing image-less?

## Acceptance criteria (for the build, not for this spec)

1. A shared tank link previews with the tank's name, counts and photograph.
2. Tapping it still lands a person in the app, on that tank.
3. Links already sent — `#/share/:token` — keep working unchanged.
4. A revoked share previews as nothing rather than as an error page.
5. A tank with no photograph still previews with its name and counts.
6. The route is public, is in the closed set the Worker's comment describes,
   and does not widen what any token already permits.

---

## Revision 1: built, and one of the costs above no longer applies

Built on 2026-09-10. The spec is otherwise unchanged; what follows is what
building it settled.

### The NFR-04 cost is gone, and that is why EXIF went first

The section above says:

> **NFR-04 is inherited, unsolved.** It requires stripping EXIF from shared
> derivatives; the app strips none…  a preview widens who fetches them from
> "people you sent the link to" to "every machine that sees the link".

**That is no longer true.** Spec 064 shipped first, deliberately and for exactly
this reason. No photograph now leaves the device carrying metadata: a preview is
canvas-derived and has none, and a photo small enough never to have earned a
preview gets a stripped copy made on the way out. So widening the audience of
the `og:image` no longer widens an EXIF exposure, because there is none to
widen.

What it does **not** fix is BUG-20 — photographs published *before* 064 still
sit in R2 with their metadata, and a preview would hand those to every unfurler
that sees the link. A keeper who shared a tank before 064 should republish it;
that re-uploads a clean derivative. This is worth saying in the share sheet
rather than only here, and is filed as part of BUG-20.

### The answers to the four open questions

1. **Does the preview need image access it does not already have?** No,
   confirmed. `/shared/:token/media/:key` is public by design and gated on
   `permits()`, which checks membership of the manifest's own `allowedBlobKeys`.
   The preview points at that route and adds nothing.
2. **What does a revoked share preview as?** Nothing. `readManifest` returns
   undefined and the route 404s, exactly as the other two do. An unfurler
   renders a 404 as a plain link, which is the right answer — a revoked share
   should not still be advertising a tank's name.
3. **Does moving the canonical URL break links already sent?** It does not, and
   this is the constraint that shaped the build: `#/share/:token` is untouched
   and keeps working forever. The Worker route is **additive**, and the app's
   own `shareUrlFor` is what changes — so a link sent yesterday resolves exactly
   as it did yesterday.
4. **Is one `og:image` enough?** Yes, and a tank with no photograph previews
   with its name and counts and no image, rather than with a placeholder. A
   generic image would make every tank look identical in a message thread,
   which is the failure this spec exists to fix.

### One thing the spec did not anticipate

**The preview route must not be a second way to read the snapshot.** It returns
HTML built from four fields; it does not return the manifest. A machine that
fetches it learns the tank's name, its counts and one image URL — which is
precisely what the keeper chose to publish — and not the resident list. That
keeps the widened audience narrower than "can read everything the app can".
