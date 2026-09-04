# 059 — Portraits arrive when you look at them

## What was asked

Asked whether the catalog's photographs should move out of the repository:

> Would there be a better design to store ALL images else where? How are all
> images stored and rendered now? What would be a better design?

and, after three options were compared:

> Agreed let's make option C an enhancement feature spec

Option C was: **keep the files where they are, and stop precaching all of
them.**

## The problem, measured

Portraits reach the app through an eager glob:

```ts
const BUNDLED_PORTRAITS = import.meta.glob('./seed/assets/portraits/*.jpg', {
  eager: true, query: '?url', import: 'default',
});
```

`eager: true` emits every file as an asset, and Workbox's `globPatterns`
includes `jpg`, so every one is precached. Measured from a real production
build on 2026-09-04:

```
precache  997 entries (25,739 KiB)

  984 jpg   20.8 MB    98.7% of entries, 83% of bytes
    1 js     4.14 MB   (672 KB gzipped — the marts are inlined, ENH-02)
    1 css  134 KB
    3 woff2 164 KB
```

**Every device downloads ~22 MB before the app works offline**, and 21 MB of it
is photographs of species that device will never open. That includes a stranger
following a share link to look at one tank.

Spec 058 has just taken portrait coverage from 989 species to **2,027**. Running
`npm run portraits` against that would take the precache to roughly **46 MB**.
This spec is what has to land first.

## Why not move them to a bucket

Considered and rejected for now, on sequencing rather than merit. R2 would hold
all 2,027 for 0.42% of its 10 GB free tier with zero egress — storage is not the
constraint and never was. But moving hosts does not by itself change the install
by one byte: a portrait precached from R2 costs exactly what a portrait
precached from Pages costs. **The install is caused by the caching strategy, not
by the address**, and this spec changes the thing that actually causes it.

It also keeps four properties that a bucket gives up, which are worth keeping
while the cheaper change is still untried:

- A portrait and the mart row that credits it move in **one commit**, so there
  is no state where the catalog claims a photograph the store does not have.
- A wrong portrait shows up **in a PR diff**.
- No new public route on the Worker, whose existing routes are all
  authenticated or token-scoped.
- No orphan problem. ENH-11 already notes the Worker has no delete route on
  purpose; regenerating 2,027 portraits into a bucket would strand their
  predecessors with nothing to collect them.

If repository weight later becomes the binding cost, the move to R2 is a
mechanical follow-up **after** this, and the hard question — whether a
runtime-cached catalog feels right offline — will already be answered.

## What changes

### 1. Two directories, not one

`build-portraits.ts` splits its output:

| Set | Written to | Emitted as | Precached |
|---|---|---|---|
| **Core** — the `CORE_PORTRAITS` most-listed species | `src/data/seed/assets/portraits/` | hashed build asset | **yes** |
| **Tail** — everything else | `public/portraits/<speciesId>.jpg` | verbatim, stable URL | no |

The split has to be by directory because Workbox selects by glob over the built
output, and a build asset's filename is a content hash — there is no way to say
"precache these two hundred" from a config file otherwise.

`CORE_PORTRAITS = 200`. Measured against the current mean of 21.6 KB that is
**4.2 MB**, taking the precache from 25.1 MB to roughly **8.6 MB** — a 66% cut
while the catalog still looks alive offline on a fresh install. The ordering is
by market listings descending, the same ordering `build-images.ts` already uses
to decide which species to attempt first.

### 2. The tail is fetched and runtime-cached

`portraitAsset()` returns the bundled URL when a species is in the core and
`${BASE_URL}portraits/<speciesId>.jpg` otherwise. No calling code changes: it is
still a URL in an `<img src>`.

Workbox gains `globIgnores: ['portraits/**']` so the tail is not precached, and
a `CacheFirst` runtime route for that path with an `ExpirationPlugin` ceiling.
A species you have opened once is offline from then on.

### 3. A portrait that has not arrived says so — and `Plate` already did this

Written expecting to add an `onError` fallback to the silhouette. **That was
wrong on both counts, and reading the component first is what found it.**

`Plate` already has the `onError`, and it deliberately does *not* fall back to
the silhouette. It draws a third state — "Picture didn't load" — because
conflating a failed fetch with "no portrait exists" would, in its own words,
tell "a user offline in a shop basement that a picture they have seen before is
gone for good". That distinction is exactly what this spec makes reachable for
the first time, and it is already correct.

What DID need building is the other half of the same distinction, which this
change would otherwise have destroyed. `portraitAsset` returning
`${BASE_URL}portraits/<id>.jpg` unconditionally would hand back a URL for every
species — including the ones with an `images.jsonl` row whose download failed,
which have no file at all. Those would 404 and start reporting "Picture didn't
load" where they honestly have no portrait.

So `npm run portraits` writes `portrait-tail.json` **from what it actually put
on disk**, and `portraitAsset` returns `undefined` for anything not in it. The
manifest cannot drift from the files the way a row can, because it is generated
from a directory listing at the end of the run.

### 4. `npm run portraits` becomes incremental

Enabling, not a bonus. It currently `rmSync`s the whole directory and
re-downloads every row; at 2,027 rows that is a two-hour run to change nothing,
and an interrupted one leaves the app with no portraits at all. It now
reconciles: delete files no longer wanted, download only what is missing. The
orphan-removal the `rmSync` existed for is kept, by deletion rather than by
demolition.

## Scope

**In:** the four changes above, and the tests for them.

**Out:**

- **Moving anything to R2.** Argued above.
- **Choosing the core by what the keeper owns.** That is runtime state and this
  is a build-time split. A keeper's own species are exactly the ones they open,
  so the runtime cache holds them after the first look; precaching them would
  need a per-user build.
- **Changing `MAX_WIDTH` or `QUALITY`.** Spec 029 sized those against measured
  alternatives; re-opening it here would confound this change's numbers.
- **Running `npm run portraits` to bundle spec 058's 1,015 new rows.** That is
  the point of doing this first, but it is a separate, hours-long run and its
  own commit.

## Acceptance criteria

1. A production build's precache is **under 10 MB** and contains at most
   `CORE_PORTRAITS` jpgs; the tail appears in `dist/portraits/` and in no
   precache manifest entry.
2. `portraitAsset()` returns a bundled URL for a core species and a
   `BASE_URL`-prefixed public URL for a tail species, for every species that has
   a portrait file.
3. Online, a tail species' card draws its portrait; the second load of the same
   card is served from the runtime cache, not the network.
4. **Offline, a tail species never opened before fails its fetch**, so `Plate`
   draws "Picture didn't load" rather than a broken-image icon — and a species
   with no portrait at all still draws the silhouette, not that. Driven in a
   browser.
5. A tail species opened while online still draws offline afterwards.
6. `npm run portraits` run twice makes zero network requests the second time,
   and removes a file whose species has left `images.jsonl`.

## Alternatives rejected

**Move to R2 now.** See above — same install, more moving parts, and it answers
a question this spec answers for free.

**Precache nothing.** A fresh install offline would be a grid of silhouettes,
which reads as a broken app rather than a loading one. The core exists so the
first impression is a catalog.

**Drop `MAX_WIDTH` to 320 instead.** Halves the bytes, changes nothing
structurally, and spec 058's coverage jump spends the headroom immediately.
Also gives up sharpness spec 029 measured and chose deliberately.

**Lazy the glob (`eager: false`).** Would code-split the URL map but Workbox
still precaches the emitted jpgs, because the manifest is built from the output
directory rather than from the import graph. It looks like the fix and is not
one.

## Requirements touched

- **NFR-02**, offline catalog — and this **narrows it**, which is the honest
  cost and needs saying plainly. The promise moves from *"the whole catalog
  draws offline"* to *"the core draws offline, and so does everything you have
  looked at"*. That is a real reduction, accepted because the alternative is a
  46 MB install for every device including a stranger's.
- **FR-R11**, licensed portrait sourcing, bundled and precached — the *bundled
  and precached* half now applies to the core rather than to all of it.


---

## Measured

A production build and a browser, 2026-09-04. The tier split itself moved 811
files and downloaded nothing — a portrait's bytes are identical either side, so
only the directory changes.

| | Before | After |
|---|---:|---:|
| Precache entries | 997 | **213** |
| Precache size | 25,739 KiB | **8,578 KiB** |
| jpgs precached | 984 | **200** |
| Tail files in the manifest | — | **0** |
| Site total on disk | 28 MB | 28 MB |

**66% off the install.** The site is the same size; what changed is how much of
it a device must take before the app works.

Browser, against a real service worker, with the origin **actually killed**
rather than `setOffline` — which does not reliably cut a loopback origin, and
reported a false pass on the first attempt:

```
online  viewed             200
online  viewed again       200      served by the runtime cache
cache holds                ["sp_aborichthys_elongatus.jpg"]
--- server killed ---
offline viewed             200      still there
offline never viewed       FAILED (TypeError)
offline app shell          200      NFR-02's core intact
```

`npm run portraits` a second time: 0 downloaded, 1,011 already had, 0 moved,
0 removed.

### One thing this run did not test

The 1,015 rows spec 058 added are not on this branch, so the split ran against
1,011 portraits, not 2,027. The projection for the full set — roughly 46 MB
precached before this, and 8.6 MB after, since the core is fixed at 200 — is
arithmetic from the measured 21.6 KB mean, not an observation. It should be
re-measured when the two land together.
