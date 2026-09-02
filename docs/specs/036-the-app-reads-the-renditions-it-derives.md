# 036 — The app reads the renditions it derives

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-A08 (renditions), NFR-01 (a screen draws in under a second on a
phone), NFR-03 (the original is never replaced).
**Completes:** spec 029, which derived thumbnails and previews and left every
reader pointed at the original.

---

## What was asked

Spec 029 ends with the honest admission, repeated in the release note that
shipped it:

> Nothing in the app's UI reads the thumbnails or previews yet. The catalog,
> the tank grid and the photo strip still load full originals; only the
> shared-page publisher uses the preview. That is the next piece of work.

This is that piece of work. Every screen that draws one of the keeper's
photographs decodes a full-size original to do it — a 3.6 MB JPEG behind a
64-pixel square in the photo strip — while a 12 KB thumbnail sits unused in the
same `media` row.

## The rule for choosing a size, rather than a judgement per screen

The tempting version of this change is "small things get the thumbnail." That
is wrong at the sizes this app actually uses, and picking per screen by eye
would leave the next reader with no way to check the choice.

`THUMBNAIL_EDGE` is **320**. A phone renders at 3× device pixels. So a
thumbnail is sharp up to **107 CSS pixels** and visibly soft above it. That is
the rule, and it is arithmetic rather than taste:

> **Thumbnail where the box is 107 CSS pixels or smaller. Preview otherwise.**

Measured against `src/app.css`, that puts each surface here:

| surface | box | reads |
|---|---|---|
| photo strip (`.photo-strip__item`) | 64 × 64 | **thumbnail** |
| tank card art (`.tankcard__art`) | 96 × 96 | **thumbnail** |
| home shelf (`.shelf-item`) | 132 wide | preview |
| catalog tile (2-up at 390 px) | ~187 wide | preview |
| tank grid (`minmax(150px, 1fr)`) | 150–195 wide | preview |
| species detail, catch hero, reveal | full width | preview |

Only two surfaces are small enough for the thumbnail, and saying so plainly is
the point of writing the rule down: "wire in the thumbnails" sounds like it
should cover the grids, and at 320 pixels it must not.

The grids are not the poor relation in this. A catalog tile goes from a
full-size original to a preview — measured below at **21× fewer bytes** — and
that is the largest single win in the change, because a catalog scroll draws
dozens of them and the two thumbnail surfaces draw one each.

## The fallback has to survive a missing blob, not just a missing key

`viewableBlobKey` already falls back from preview to original when the key is
absent — for a photo smaller than 1280 pixels, which has no preview and never
will. That is not enough here.

On a **second device**, blobs arrive through the sync queue, which sends
thumbnails first, then previews, then originals (FR-A03). The row can be
present with all three keys while only one of the three blobs has landed. A
reader that resolves a key and stops would draw nothing where today it draws
the original.

So the ladder is walked against storage, not against the row:

```
thumbnail → preview → original
```

`readMediaBlob(media, size)` tries each rung in turn and returns the first blob
that is actually in `db.blobs`. It is the only new concept in this change, and
it exists because the half that is easy to get right — the key — is not the
half that fails.

This also makes the change safe for the photos that predate spec 029. There is
still no backfill: every photo captured before that day has only an original,
falls straight through the ladder, and looks exactly as it did.

## One of the two thumbnail surfaces had no thumbnail to read

**Correction, 2026-09-02.** An earlier version of this spec, and the commit
message that shipped it, said this gap "went unnoticed because nothing read a
rendition until now." That was wrong, and it made spec 029 look sloppier than
it was. Spec 029 named it plainly in its own *Not done here* list:

> **`setTankPhoto`** still stores its buffer unchanged; only `addPhotos`
> derives today. The tank photo is one image per tank rather than one per
> fish, so it is the smaller half of the cost.

The disclosure was there. What was wrong was the **cost estimate**, and it is
worth being exact about why, because the reasoning is the sort that sounds
obviously right.

Only one of the three paths that write a photograph derived renditions:

| writer | what it is | derived before | derived now |
|---|---|---|---|
| `addPhotos` | a photo added to a record | yes (spec 029) | yes |
| `setTankPhoto` | the picture on a tank | no | **yes** |
| `createCatchDraft` | the first photos of a catch | no | no — below |

"One image per tank rather than one per fish" is true, and it is the right way
to count **local storage**. It is the wrong way to count a **shared page**,
where the tank photo is the header image and every other picture on the page
was already a preview. Measured on a tank with eight photographed fish, the
one image judged cheapest to skip was **67% of the page's bytes** — 10.17 MB
of a 15.10 MB page. The numbers are below.

So the lesson is not "somebody should have noticed." It is that a per-image
cost was compared against the wrong denominator: cheapest per copy, dearest
per page, and only the second one is what a guest waits for.

It also matters locally: the tank card is one of only two surfaces small
enough for the thumbnail, so pointing it at a thumbnail that never existed
would have been a change that measured as an improvement and delivered
nothing.

`setTankPhoto` now derives inline, in the same transaction as the original, so
a `media` row can never name a blob that is not stored beside it. Inline is
right there and wrong on the capture path — see below.

## Why `createCatchDraft` is left alone, deliberately

It is the other missing writer, and it is the busiest one: the first
photographs of a fish you just caught.

FR-C02 says the draft is created **before** media finishes writing, because
that moment is someone standing in a fish shop with a phone. A derivation was
timed at **167–227 ms per photo** on a desktop-class CPU in Chromium; a phone
is several times slower, so deriving inline would put something like a second
between the shutter and the record appearing, on the one path the requirement
explicitly protects.

The answer is to derive *after* the draft commits and update the row when it
lands — which needs a decision about what happens when the tab closes
mid-derivation, and is a change with its own argument to make. Doing it here,
badly, to make a table look complete, is how FR-C02 would quietly stop being
true.

The gap is narrower than it sounds: a catch's first photos miss out, and every
photo added to the record afterwards goes through `addPhotos` and does not.

## Two leaks fixed, because they are the lines being changed

`blob-url.ts` exists because four hand-rolled versions of object-URL lifetime
management drifted and two of them leaked. Its docstring says so. Two more had
grown since, and both are lines this change had to touch anyway:

- `useTankSummaries` minted `URL.createObjectURL(blob)` inside `useLiveQuery`
  and never revoked it. That query re-runs on any write to `aquariums`,
  `holdings`, `residencies`, `lifeEvents`, `speciesProfiles`, `media`,
  `blobs` or `priceObservations` — so every catch logged leaked one full tank
  photo per tank, permanently, for as long as the tab lived.
- `Home`'s `SpecimenPlate` did the same, once per shelf item.

Both now yield blobs from the query and let `useBlobUrls` / `useBlobUrl` own
the URL, which is the pattern the rest of the app already uses. Fixing a leak
on the line you are editing is cheaper than filing it; leaving it would have
meant this change made those two queries read *smaller* blobs and go on
leaking them.

## What deliberately still reads the original

- **The share sheet in `IdentifyFlow`.** `navigator.share` hands a real file to
  another app. Sending a re-encoded 1280-pixel copy of someone's photograph
  because it was cheaper to fetch would be the app quietly degrading the thing
  it was asked to pass on. It reads `originalBlobKey`, with a comment saying
  why so the next reader does not "fix" it.
- **Export** (`portability/export.ts`), which already writes all three keys and
  should: an export is the archive.
- **The crop sheet**, which crops the file in hand before anything is stored.

## Not done here

- **Renditions on the capture path**, above. The largest piece of work left
  in this area, and the one with a requirement to design around.
- **No backfill.** Photos from before spec 029 — and every catch photo until
  the point above is built — keep only their original and will always be read
  at full size. A backfill is a separate change with its own cost (decoding
  every stored photo on a device that may have hundreds) and it is tracked
  rather than smuggled in here.
- **`srcset`.** The correct answer for a tile that is 96 px on one device and
  190 px on another is to offer the browser both and let it choose. That needs
  two object URLs per picture and a width descriptor per rendition, and it is
  worth doing only once there is more than one rendition below 1280.

## Measured, not asserted

Driven in a real browser (Chromium) against the built modules, real IndexedDB
and a real canvas — the writers and the readers together, not a mock of
either. The "27 MB portrait budget" that turned out to be off by 3× is why
this section exists, and the first draft of this spec did the same thing: it
guessed "~150 KB preview, 12 KB thumbnail" and was wrong about both.

**One camera-scale photograph** (4000 × 3000) put through `setTankPhoto`, then
read back through `readMediaBlob`:

| | bytes | vs the original |
|---|---|---|
| original stored | 10,685,182 | — |
| what a preview surface now reads | 617,487 | **17× less** |
| what a thumbnail surface now reads | 38,116 | **280× less** |

The same photograph through `addPhotos` gives byte-identical results, which is
the point of both writers calling the same function.

The source is synthetic pixel noise, which compresses far worse than a
photograph — spec 005 measured a real phone capture at 3.6 MB against this
10.7 MB. The **ratios** are the finding and they are what carries over. Every
one of these surfaces read the full original before this change, so "before"
is the first row by construction rather than by estimate.

**What the app actually decodes now.** The strongest check available, because
it does not take the code's word for which key it resolved — it asks the
browser how wide the decoded image is, in the running app at a 390 × 844 phone
viewport, on a seeded tank and a record with three photographs:

| surface | box | decoded image | before |
|---|---|---|---|
| tank card | 96 px | **320 px** — the thumbnail | 4000 px |
| photo strip, ×3 | 62 px | **320 px** — the thumbnail | 2400 px |
| record hero | 358 px | **1280 px** — the preview | 2400 px |

No page errors, and every one of those images is a live `blob:` URL owned by
`useBlobUrl`/`useBlobUrls` rather than minted inline.

**A photograph already small enough to need nothing** (600 × 400, 215,085
bytes):

| | |
|---|---|
| preview derived | **none** — `planRendition` never upscales |
| what a preview surface reads | **215,085** — the original, byte for byte |

That is acceptance criterion 3, checked rather than assumed, and it is the
normal case for every photo taken before spec 029.

**The sync race, reproduced.** The record's thumbnail blob was deleted while
its `media` row kept naming it — which is exactly what a second device looks
like part-way through the queue. A thumbnail surface then read **617,487**
bytes: it fell to the preview and drew a picture, where a reader that trusted
the row would have drawn nothing.

## What it is worth, measured against the version it replaces

Added 2026-09-02, in answer to "how does this improve the experience, and can
you quantify it?" — a fair challenge to a section that had byte ratios and no
time in it. Everything here is an A/B: `81f7141` (the tree this replaced) built
and served alongside `33a8877`, both seeded with byte-identical photographs,
both driven at a 390 × 844 viewport with the CPU throttled 4× to approximate a
mid-range phone. Median of five runs.

### Time until a screen shows its pictures

| screen | before | after | |
|---|---|---|---|
| tank list, 6 tanks | **2,392 ms** | **367 ms** | 6.5× |
| fish record, 12 photos | **4,742 ms** | **457 ms** | 10.4× |

The spread matters as much as the median. A record ranged 3,810–6,527 ms
before and 414–556 ms after: it was not merely slow, it was unpredictably
slow, which is the part a person remembers.

### Memory pinned by photographs

`createObjectURL` / `revokeObjectURL` were instrumented in the page, so this is
a count rather than an inference. Six tanks, ten trips between the tank list
and home inside one document:

| | before | after |
|---|---|---|
| first arrival at the tank list | 61.0 MB | 0.23 MB |
| after ten trips | **752.5 MB, still climbing** | 0.23 MB (peak 1.46 MB) |
| object URLs revoked | **0 of 74** | 70 of 76 |

Two independent effects, and it is worth keeping them apart: reading a
thumbnail rather than an original made each retained blob ~264× smaller, and
fixing the leak stopped the count growing at all. The leak would have grown
just the same with no renditions in the picture. It is filed as BUG-13.

### What a guest downloads for a shared tank

The publish path has chosen preview-first since spec 029, so **fish photos are
unchanged** by this spec — 616,450 bytes each, in both builds, measured. The
tank photo is the whole difference:

| | before | after |
|---|---|---|
| tank cover photo published | 10,170,059 B | **616,386 B** |
| whole page, 8 photographed fish | 15.10 MB | **5.55 MB** |

### Time until a guest sees the tank

Real published bytes, same viewport and CPU throttle, Chrome's own network
presets:

| connection | before | after | |
|---|---|---|---|
| Fast 4G (9 Mbps) | **9,270 ms** | **685 ms** | 13.5× |
| Slow 4G (1.6 Mbps) | **51,358 ms** | **3,417 ms** | 15.0× |

Bandwidth-bound, so barely any variance: 51,358 / 51,381 and 3,417 / 3,408.
Fifty-one seconds of empty header before a stranger sees the tank is not a
slow page, it is a closed tab.

**No backfill, so this is not retroactive.** A tank photo set before this
change has no preview and still publishes the original; the keeper has to
re-set the tank's photo and update the share. Worth saying out loud, because
re-publishing alone looks like it should be enough and is not.

### What it costs

190.9 MB → 194.8 MB stored for the same 18 photographs, 42 blobs → 54: about
**2% more disk** for the derived copies. That is the entire downside.

### Caveats

A 4× CPU throttle approximates a phone, it is not one. The test photographs are
4032 × 3024 — a real phone's resolution — but synthetic noise, which
compresses worse than a photograph, so decode cost is representative while file
sizes run high. The guest timings serve the real published bytes from a local
server rather than R2 through the Worker; the snapshot fetch and the Worker's
redirect are identical either side, so the difference is faithful, but the
absolute times exclude that round trip. The ratios and the URL counts are the
robust findings.

## Acceptance criteria

1. The photo strip and the tank card read the thumbnail when one exists. ✅
2. Every other photo surface reads the preview when one exists. ✅
3. A photo with no renditions renders exactly as before. ✅ (measured)
4. A row whose preferred blob has not synced yet falls back rather than
   drawing nothing. ✅ (tests, and the guard was checked by putting the bug
   back — two named tests go red)
5. The share sheet still hands over the original. ✅
6. Neither `useTankSummaries` nor `SpecimenPlate` leaks an object URL. ✅
7. A tank photo has renditions derived for the card to read. ✅ (browser)
8. `vitest run` and `npm run build` both green. ✅
