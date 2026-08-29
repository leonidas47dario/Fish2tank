# The Drawer — the UI/UX redesign, as shipped

This directory used to hold a proposal. The proposal is now the app: every
change described below is in `src/`. `prototype/` keeps the static board it was
designed against, which no longer matches the running build and is here as a
record rather than a reference.

---

## Design read

**Reading this as:** a mobile-first collecting-and-field-log PWA for aquarium
hobbyists standing in a shop aisle, with the existing "Midnight Aquarium"
language kept and sharpened.

This is product UI, not a landing page, so the hero-composition and
marketing-copy parts of the anti-slop frontend skill do not apply. Typography,
colour calibration, materiality, interactive states, image strategy, motion
motivation, dark-mode discipline and the AI-tells list do.

**Mode:** overhaul the visuals, preserve the information architecture. No route
changes, no nav relabelling, no renamed form fields.

**Dials:** `DESIGN_VARIANCE 6`, `MOTION_INTENSITY 4`, `VISUAL_DENSITY 6`.

---

## What it cost, measured

Both columns are the same seed data, the same viewport (390×844) and the same
scripts, run against a build of `origin/uat` and a build of this branch.

| | Before | After |
|---|---|---|
| Catalog document height | 555,102 px | **233,416 px** |
| Catalog, first tile on screen | 1,491 ms | **~900 ms** |
| Full style + layout pass over the grid | 769 ms | **~100 ms** |
| Specimen page (six tanks screened) | 10,174 px | **3,560 px** |
| Home | 1,181 px | 1,081 px, and now has fish on it |
| Tanks / Journal / Settings (untouched) | 13,864 / 902 / 1,955 px | 13,624 / 896 / 1,934 px |

Reproduce with `npm run build && npm run preview`, then `npm run shots`.

---

## The eight moves

**1. The catalog is drawn against the data that actually exists.**

The most important finding in the exercise, and it was not a data problem but a
design one. The shipped tile was a collectible card built around three coloured
discs holding price, adult size and minimum tank, a format whose entire
structure is three numbers, on a library that rarely has three numbers.

Measured against the current mart (2,178 species):

| Field | Recorded for |
|---|---|
| Adult size | 689 |
| Minimum tank volume | 92 |
| Temperament | 206 |
| Water column | 1,077 |
| **Both size and volume** | **92** |

The spec 003 care backfill, which landed on uat while this redesign was being
built, moved one of those numbers and not the other: adult size went from 47 to
689, and minimum tank volume stayed at 92. That strengthens the case rather than
weakening it. The tiles now differ from each other in *which* facts they carry,
so a fixed three-slot layout would draw a gap on nearly every one.

The tile is now the photograph, with the facts under it in one line, and a fact
that does not exist is not drawn. See `ui/components/Tile.tsx`.

**2. Every photograph gets a derived plate.**

A portrait never sits on the canvas. It sits on a plate derived at build time
from that photograph's own border ring: the **mode** in a quantised cube — not
the median, which averaged plants and gravel into a chartreuse appearing
nowhere in the image — converted to OKLCH with **chroma clamped to 0.04**, so a
plate can never become a colour field.

`scripts/derive-plates.mjs` (`npm run plates`) writes one `--plate-l/-c/-h`
triple per portrait into `src/theme/plates.css`. Across the 1,011 bundled
portraits: 442 dark-edged, 239 light-edged, 330 between. That spread is why one
fixed letterbox colour was never going to work.

The image supplies hue, chroma and lightness, because all three are facts about
the photograph. The **theme** supplies `--plate-l-min` and `--plate-l-max`,
because how light a mat may be is a fact about the page. So one generated file
serves all three territories and a theme change stays a token swap — baking
absolute lightness into the generated file would mean re-running the derivation
per theme, which is the migration PRD 7.3 forbids.

This is what makes `object-fit: contain` affordable. A fish is a long
horizontal animal, and the old 3:4 `cover` card kept about 37% of a 3:2
photograph's width, cropping through the middle of the animal.

**3. The grid windows itself, in two declarations and no dependency.**

2,178 species is 1,089 rows two-up. `content-visibility: auto` plus
`contain-intrinsic-size: auto 190px` on `.tile` lets the browser skip layout,
paint and style for everything off screen. Measured by forcing a full reflow
with the property on and then disabled: **~100 ms against ~770 ms**.

Worth recording how that was verified, because the obvious methods are wrong.
Counting skipped tiles by reading a bounding rect *forces* the skipped subtree
to render, and `checkVisibility({contentVisibilityAuto: true})` reported every
tile as rendered either way. Only the cost is observable. `npm run shots`
prints both numbers.

**4. The verdict may never be calmer than its own contents.**

All five engine levels (`suitable / conditional / high-risk / extreme-risk /
insufficient-data`), and the reason the pill says what it says is printed on the
**collapsed** row. Nobody expands a row to be talked out of amber. The engine
already aggregates worst-wins and writes its top findings into `headline`; the
old screen rendered that headline as 11px grey text under a badge, which is how
a row reading *Conditional* could hide "eats 4 residents" one tap down.

Nothing was removed to get this screen from 10,174 px to 3,560 px. FR-E04 still
holds: every factor, every input, every missing input and the rules version are
reachable, one tap further in — and `scripts/smoke.mjs` now walks both taps
rather than clicking whatever `<details>` it finds first.

**5. Price says how much it is standing on.**

`n=` on every band, and any band below the index's own `minimumSampleCount` is
drawn as the hairline it is, under a line saying why. Eight smooth bars scaled
to the maximum read as a distribution; seven of those eight bands routinely hold
one listing. Ask, member and paid stay three separate facts.

**6. Type, colour, icons.**

Geist and Geist Mono, self-hosted, with mono reserved for what is *counted* and
never for sentences. Georgia is gone: a system serif is a different serif on
every device, so a design that specifies it has not specified a face.

One second family, Source Sans 3 Italic, for the one role where italic carries
meaning. Geist ships no italic axis, so every binomial in an app about 2,176
Latin names was a synthesised slant of a neutral grotesk.

The open question — "40 KB on an offline-first bundle, worth it?" — answered
itself once the assets were measured. The three faces total **157 KB** next to
**24 MB** of bundled portraits: 0.6% of what the app already ships, and all
three are precached by the service worker.

Phosphor replaces the typed characters `⌂ ◈ ◉ ▤ ✎`, which rendered at a
different weight and baseline in every system font and which some platforms have
no glyph for at all. One family, one weight, re-exported through
`ui/components/Icons.tsx` so that is a fact about a file rather than a
convention someone has to remember.

**7. The depth ramp is anchored to the viewport.**

It was `background-image` on `<body>`, which sizes the gradient to the *scroll*
height. Over a catalog 583,302 px tall the shift within any one screen was under
0.04 L: present in the stylesheet, invisible on the device. It is now a fixed
layer behind everything, and its last stop equals `--color-canvas` exactly, so
there is no visible step where it ends.

**8. States are designed, because an offline-first app meets them constantly.**

Loading is a skeleton shaped like the grid. "No portrait exists" (1,167 species,
permanent) and "the portrait failed to load" (transient) are different facts on
different surfaces. Stale market data reads calm with a date on it, not red. An
empty search offers a way out, and so does a species id that no longer resolves.
The shimmer's duration is a token, so the in-app reduced-motion toggle actually
stops it — a literal there survives the token change and leaves an infinite
animation running on every tile in the grid.

---

## Accessibility, measured rather than claimed

`npm run contrast` walks the rendered DOM in **all three visual territories**,
resolves what each piece of text is really painted on — compositing translucent
ancestors and the `color-mix()` fills the token file never spells out — and
exits non-zero below AA. It checks hover and pressed states too.

Currently: **312 distinct text-on-background pairs, all three themes, pass.**

That script exists because every accessibility claim in the original proposal
was a number written in a CSS comment, and comments do not fail a build. It
immediately found two things that reading the stylesheet had not:

- `button:hover:not(:disabled)` scores (0,2,1) and beat `.btn--primary` at
  (0,1,0), so hovering the Capture button — the one control the Catch screen
  exists for — repainted it `--color-surface` while keeping
  `--color-on-primary` text. **1.05:1.** The generic hover is now wrapped in
  `:where()` so it carries no specificity, and each variant states its own.
- "No portrait" sat on `--plate`: a per-image derived colour, clamped to a
  themed band, hatched. 4.0:1 on the dark theme and **1.35:1 on the
  fieldbook** — the one piece of text 1,167 species in this library actually
  show. It now sits on a known surface.

Also holding, by construction:

- Three text tiers at 17.37 / 8.75 / 5.92 on canvas. 11px is the floor.
- A separate `--color-border-control` at 3.56:1 for anything whose boundary
  identifies a control (1.4.11). One token for both jobs had every input and
  chip in the app at 1.4:1.
- One `:focus-visible` rule on everything focusable, **plus** a
  `forced-colors: active` outline — `outline: none` with a box-shadow ring
  means no focus indicator at all in Windows High Contrast.
- `--tap-min: 44px` (2.5.8) on every pressable thing.
- `--color-on-primary` themed per territory: dark ink on the fieldbook brown is
  3.19:1 and fails, white is 5.87:1.
- Decorative generated glyphs use `content: '✓' / ''`. An earlier pass used
  `speak: never`, which is a no-op — CSS Speech was never implemented in any
  shipping engine, so every factor value was still being announced as "black
  square, eats four residents".

---

## Three bugs found on the way, all fixed

**The Dream List was unreachable.** `addToDreamList` existed and feeds 25 points
of the Discovery tier, but no screen called it, and Home rendered a standing
"Add species from the Collection" pointing at a screen that could not. There is
now a "Want one" control on the species page and a `removeFromDreamList`
counterpart, because adding without removing is a one-way door. A *fulfilled*
entry is never deleted: that one is history, and it is why the tier can award
for it.

**No scroll reset on navigation.** Tapping a fish from deep in the catalog
opened its page already scrolled past the photograph, the name and the care
profile, landing on the store list — worse the deeper you browsed.

**No scroll restoration on Back.** You landed at the top of 2,178 species. Both
live in `ui/ScrollMemory.tsx`, and the fix took three attempts worth recording:

- recording the outgoing position in a passive `useEffect` cleanup runs *after*
  the incoming route's layout effect has already scrolled to 0, so every entry
  recorded itself as 0;
- a 1.2s restore budget expired before the catalog had any height, leaving the
  page at 109px;
- HashRouter hands out the key `default` to any entry it has no state for, so
  two unrelated species pages shared one key and the second opened at the
  first's scroll position.

---

## Trimmed, deliberately

Home's "stories you have not written" block, and Dream List as a permanent Home
section — it now appears only when it has something in it. The collectible-card
gem treatment (`FishCard.tsx`, deleted) and the 7px three-segment water-column
pip, which said the right thing and could not be read at tile scale.

---

## Deviations from the proposal, and why

**The default catalog sort is not in-stock-first.** The proposal argued for it,
and it is one of three orders, but not the default. The in-stock flag comes from
an unscheduled scrape of mail-order stores and much of that dataset is sold-out
back catalogue years old; ordering the whole library by it silently asserts a
present tense the data cannot support. The default is `Yours first` — your
collection, then the species this app can actually picture — which solves the
real problem (opening the library on the African Clawed Frog, on a first screen
of grey placeholders) without claiming anything. Choosing `In stock` prints the
collection date underneath it.

**The proposal's "Fits 12 / Can't tell 1,029" chips are not built.** Screening
2,178 species against every tank on catalog load is not a chip, and the number
was contentious in review. The chips carry real counts of what they filter.

**Rounds 1–7 of the proposal were rated by subagents against fixed rubrics and
never reached the 8.0 bar** — best 6.07 average, and distinctiveness never above
5. That process stopped on the no-material-improvement rule. This
implementation is a separate artifact and those scores do not transfer to it.

---

## Known gaps

1. **User-captured photos have no derived plate.** The derivation is a build
   step over bundled portraits, so a photo taken this morning falls back to the
   theme's plate value. Deriving in the browser on capture is the fix.
2. **The catalog is still a 233,416 px document.** Windowing made it cheap to
   render, not short. Search and the filters are the answer to depth; nobody
   scrolls to the bottom of 2,178 species.
3. **The price ladder still shows seven bands at n=1** for some species. Each
   band now states its n and is drawn thin, which was the honesty fix, but
   collapsing to the range line plus the one comparable band would save several
   hundred pixels.
4. **Tanks and Journal were not redesigned.** They render correctly on the new
   tokens and are measurably unchanged, but Tanks is still 13,624 px.
