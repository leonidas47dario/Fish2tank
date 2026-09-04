# 055 — A photo you have already decoded

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** NFR-03, P3, BUG-13's rule.
**Builds on:** spec 053 (which made each tile load its own picture).

---

## What was asked

> It seems like the catalog is no longer caching but it's pulling new image
> every time it's refreshes? Not an ideal behavior

Confirmed with the keeper as being about **their own photographs** — the cards
for species they have caught — rather than the bundled portraits.

## What was actually verified first

Before changing anything, the caching that *was* suspected was checked, and it
is fine:

- the service worker precaches **997 entries, 984 of them portraits**, with
  `revision: null`, so Workbox keeps them across updates rather than re-fetching
- **zero portrait URLs changed** across the eight deploys that evening (984
  before, 984 after), so nothing forced a re-download
- spec 053's `preview → thumbnail` change cannot make an image bigger: the
  ladder is `[thumbnail, preview, original]`, so a photo with no thumbnail falls
  back to the exact blob it used before

The bundled portraits were never the problem. Recording that here because the
obvious suspect was wrong, and the next person to read this report will suspect
it too.

## The real mechanism

A keeper's own photograph is a Blob in IndexedDB, and it is drawn like this:

```ts
const blob = useLiveQuery(…);      // a NEW Blob object every time it runs
return { art, ownUrl: useBlobUrl(blob) };   // a NEW object URL every time
```

**A new object URL is a new cache key to the browser**, so the JPEG is decoded
again from nothing — even though the identical bytes were decoded a moment ago.
That happens on every mount, and `useLiveQuery` re-runs on any write to a table
it read, so one photograph finishing its sync re-mints and re-decodes every
own-photo card on the catalog at once.

Nothing was caching these because nothing ever had: the URL is minted, used, and
thrown away.

## Why the fix is not simply "keep the URLs"

`URL.createObjectURL` pins its Blob for the lifetime of the document. **A cache
of object URLs that never revokes is BUG-13**, the 752 MB leak this project
already shipped once, measured at 74 URLs created and 0 revoked.

And a cache that revokes on eviction is worse than useless if it revokes a URL
still on screen: the catalog renders all 2,176 cards at once (ENH-03), so every
own-photo card is mounted simultaneously. A size-capped LRU would revoke URLs
that are being displayed, and the fix would present as broken images.

So the cache is **reference-counted**. A URL is revoked only when nothing is
using it *and* it has aged out of a bounded idle list. Both halves are
necessary: refcounting alone grows without limit, eviction alone breaks live
images.

The counting lives in `src/ui/media-cache.ts` as a plain module with no React in
it, so the rule that decides when bytes are freed is testable rather than
observable only by watching memory.

## What this does and does not fix

**Fixed: everything within one page's life.** Scrolling the catalog away and
back, navigating to a species and returning, and every `useLiveQuery` re-run
caused by an unrelated write now reuse the same URL — so the browser reuses its
decoded image instead of decoding the same JPEG again.

**Stated precisely, because it is easy to overclaim:** the Blob is still read
out of IndexedDB on a remount. That read is cheap — a 320px thumbnail — and the
decode it used to force was not. What this removes is the decode and the URL
churn, not the read.

**Not fixed: a hard reload.** A refresh is a new document, and object URLs do
not survive one; the blobs have to be read and decoded again. Making *that*
cheaper means putting the bytes somewhere the browser's own HTTP cache can hold
them — a Cache Storage entry served by the service worker under a synthetic URL
— which is a larger change touching the SW, and is filed rather than smuggled in
here.

## Not done here

- **Serving own photos through the service worker.** See above; it is the fix
  for reloads and it is its own piece of work.
- **Windowing the catalog** (ENH-03). Still the reason every own-photo card is
  mounted at once, and still open.

## Acceptance criteria

Nine unit tests on the cache itself, plus a browser measurement at 390×844 on a
tank of **12 fish each carrying their own photograph**, driven through eight
round trips in and out, before and after.

1. Remounting a card reuses the same object URL rather than minting a new one.
   ✅ **Measured:**

   | across 8 round trips | before | after |
   |---|---|---|
   | object URLs minted | **96** | **0** |
   | outstanding at the end | 12 | 12 |

   96 is exactly 12 photographs × 8 visits — every one re-minted, and every
   re-mint a fresh JPEG decode. After, the cache hands back the same string and
   nothing is minted at all.
2. A URL in use is never revoked. ✅ — unit-tested directly, and in the browser
   **0 broken images** across all 12 tiles after the eight round trips.
3. Bytes are released once nothing uses a URL and it ages out. ✅ — unit-tested:
   past the idle limit the three oldest are revoked, in order.
4. Total outstanding URLs stay bounded under repeated navigation — measured. ✅
   — 12 outstanding in **both** builds, so this does not reintroduce BUG-13;
   and the unit test drives 10 rounds × 30 photos and asserts the held count
   never exceeds the limit.
5. The tank grid gets the same benefit, through the same cache. ✅ — that is
   the surface the measurement above was taken on.
6. A photo that is genuinely gone still renders the honest placeholder. ✅ —
   `TileArt` distinguishes "still reading" from "not there".

One consequence handled rather than discovered later: an object URL pins its
Blob for the life of the document, so **Erase everything** now resets the cache.
Without that, up to forty photographs would survive an erase in memory after
the rows they came from were gone.
