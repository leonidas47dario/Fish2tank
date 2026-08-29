# Fish2Tank UI/UX redesign - "The Drawer"

A design proposal. Nothing here is wired into the app; no file under `src/` was
touched.

Open `index.html` in a browser. Six phone frames: Home, Catalog, Species,
Specimen, States, More filters.

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

## How this was made

Seven rounds. Each one was rated by three independent reviewers against fixed
rubrics: visual craft, UX and information architecture, and accessibility plus
token discipline. Every round's named defects became the next round's work.

| Round | Visual | UX | A11y | Average |
|---|---|---|---|---|
| 2 | 5.0 | 5.0 | 4.0 | **4.67** |
| 5 | 6.4 | 6.2 | 5.4 | **6.00** |
| 6 | 6.0 | 6.2 | 6.0 | **6.07** |
| 7 | not re-rated | | | |

The target was 8. It did not get there, and rounds 5 to 6 moved 0.07, so this
stopped on the agreed rule rather than on reaching the bar. Round 7 applied
every remaining named fix but was not re-rated, so treat the last row as
unmeasured rather than as an improvement.

**What the reviewers caught that mattered most**, all of which are fixed:

- The verdict was compressed from the engine's five levels to three, so a tank
  reading *Conditional* hid "eats 4 residents" in red underneath.
- `--color-accent` was aliased to `--color-primary`, which silently collapses
  three shipped component pairs that use the two colours to tell things apart
  (`.tier--uncommon/rare`, `.gem--cost/size`, `.zone-pip--mid/top`).
- The species screen said "Fits none of your 6 tanks" when four of the six were
  unmeasured, on the newest screen, breaking the product's own spine.
- The first depth gradient was painted across scroll height, so within one
  viewport it shifted under 0.04 L. Decoration, measured as such.
- `plates.css` baked absolute lightness into a generated file, which would have
  made a theme change require re-running the derivation.
- `speak: never` was used to hide decorative glyphs from screen readers. It is
  a no-op; CSS Speech was never implemented in any engine.
- The catalog was drawn against data that does not exist. See below.

---

## Audit of the shipped build

Measured from the checked-in smoke screenshots and the seed assets.

| Finding | Evidence |
|---|---|
| Catalog renders all 1,076 cards, unvirtualised, one per row | `smoke-shots/08-collection.png` is **583,302 px tall**, about 700 phone screens |
| Specimen prints 7 factors for each of 6 tanks, expanded, no sticky header | `smoke-shots/04-evaluate.png` is **20,286 px tall** |
| Library sorts alphabetically | It opens on *African Clawed Frog* |
| Photographs fight the canvas | 120-portrait sample: 10% white cut-outs, 20% near-black, 70% full-bleed |
| Missing-portrait fallback is an emoji | 381 of 1,076 species hit it |
| Price-by-size chart breaks its own layout | From the 9" row down the value wraps onto its own line |
| Search clips its own placeholder | "…or trade nam" |
| Home shows no fish at all | A visual collecting app whose front door is a list of text rows |
| Georgia as the display face | A system serif, different on every device |
| Nav icons are typed characters | `⌂ ◈ ◉ ▤ ✎` |

### Kept, because it already works

The token contract. Non-colour status encoding (glyph + word + border style).
The 3:2 landscape card and the reasoning behind it. The refusal to invent a
number, which this redesign makes louder rather than quieter.

---

## Result

Benchmarked against every round, not only the shipped build, so the proposal
cannot hide its own regressions.

| Screen | Shipped | Round 2 | Final |
|---|---|---|---|
| Specimen | 20,286 px | 1,794 px | **~2,000 px** |
| Catalog | 583,302 px, 1-up, alphabetical | 2-up | 2-up, in-stock-first |
| Home | no fish | 1,010 px | **806 px** |
| Species (pre-purchase) | buried | absent | **~1,200 px** |

The specimen is larger than round 2's low-water mark. That is the cost of the
honesty fixes: the worst factor printed on the collapsed row, `n=` on every
price band, the "not enough to compare" refusal, ask/member/paid kept as three
facts, and a "Check my tanks again" control. All are load-bearing.

---

## The moves

**1. The catalog is drawn against the data that actually exists.**

The most important finding in the whole exercise, and it was not a data problem
but a design one. The catalog mart has no `adultSize` or `minimumVolume` field
at all, and `species-catalog.ts` carries a care profile for **47 of 1,076
species, 4.4%**. Earlier rounds drew nine of ten tiles with a confident
`3in 5gal` pair. The tile was designed around three numbers that exist for one
row in twenty.

The grid now uses ten real rows from `marts/catalog.json` in the real default
order. Four of ten show size and tank, because four of ten actually have them.
Where a fact is missing the tile does not draw it, and one line above the grid
says why for the whole library. The chips say `Fits 12` and `Can't tell 1,029`,
because a Fits count larger than the 47 screenable species is a number the app
would be inventing.

Worth noting for the sort: in-stock-first correlates with being well
documented, so the *default view* runs about 40% profiled against the global
4.4%. The sort is doing more work than it was given credit for.

**2. Every photograph gets a derived plate.**

A portrait never sits on the canvas. It sits on a plate derived from that
photograph's own border ring: the **mode** in a quantised cube (not the median,
which averaged plants and gravel into a chartreuse that appeared nowhere in the
image), converted to OKLCH, with **chroma clamped to 0.04** so a plate can never
become a saturated field.

The image supplies hue, chroma and lightness, because all three are facts about
the photograph. The **theme** supplies `--plate-l-min` and `--plate-l-max`,
because how light a mat may be is a fact about the page. So one generated file
serves all three territories and a theme change stays a token swap. An earlier
version gave the whole lightness channel to the theme, which put every dark
portrait in a near-white mat under both light themes.

One clamp everywhere, hero included: a hero's neighbour is its own catalog
tile, one tap earlier.

**3. The verdict may never be calmer than its own contents.**

All five engine levels (`suitable / conditional / high-risk / extreme-risk /
insufficient-data`), the collapsed pill is the **worst** factor rather than an
average, and that factor is printed on the collapsed row. In the aisle the pill
*is* the answer; nobody expands a row to be talked out of amber. Every factor
value carries a glyph, because positive and caution are **1.08:1 apart in
greyscale**.

**4. Price says how much it is standing on.**

`n=` on every band, sub-threshold bands drawn thin, and the comparison gated
behind the same minimum `price-fit.ts` enforces. Stock carries its own date,
because a present-tense green pill sourced from an unscheduled scrape is an
invented number in a nicer hat.

**5. Type, colour, icons, motion.**

Geist and Geist Mono, with mono reserved for what is *counted* and never for
sentences. One second family, Source Sans 3 italic, for the one role where
italic carries meaning: Geist ships no `ital` axis, so every binomial in the app
was a synthesised slant of a neutral grotesk, on a product whose subject is
1,076 Latin names. Phosphor, subset, replacing typed glyphs. No glows anywhere.

---

## Accessibility, computed rather than claimed

- Text tiers 17.37 / 8.75 / 5.92 on canvas; 11px is the floor.
- Separate `--color-border-control` at 3.56:1 for anything whose boundary
  identifies a control (1.4.11).
- One `:focus-visible` rule on everything focusable, **plus** a
  `forced-colors: active` outline, because `outline: none` with a box-shadow
  ring means no focus indicator at all in Windows High Contrast.
- `--tap-min: 44px`, and the reduced-motion blanket on **both** the OS media
  query and the in-app toggle.
- `--color-on-primary` and `--color-on-danger` themed per territory: dark ink on
  the fieldbook brown is 3.19:1 and fails; white is 5.87:1.
- Decorative generated glyphs use `content: '✓' / ''` alt text.

---

## Known gaps, honestly

1. **Round 7 was never rated.** It fixes every item the round-6 reviewers named,
   but nobody has checked it. Assume unverified.
2. **Only midnight-aquarium has been looked at.** The two light themes are
   verified by arithmetic only. The board ships no `[data-theme]` switcher, and
   the a11y reviewer expects more findings there, particularly around the plate.
3. **The price-by-size chart still argues with itself:** eight bands, seven at
   `n=1`, under copy saying there is not enough data to compare. Two reviewers
   flagged it. Collapsing it to the range line and the one comparable band would
   save several hundred pixels.
4. **Distinctiveness never got above 5.** Three reviewers said the same thing:
   strip the binomial and what remains is pill chips, rounded cards, a blue
   primary and a tab bar with a raised centre control. The depth ramp and the
   `top/mid/btm` column are the only product-specific ideas that landed.
5. The plate needs an ETL field and a class per species; user-captured specimen
   photos have no build-time class and fall back to the theme value.

## Trimmed, deliberately

Home's "stories you have not written", Dream List as a Home block, Fish Heaven
and Keeper's Code as top-level Journal sections, the full per-factor "Values
used" panels, the scarcity pill beside the rarity tier, and per-tile stock
counts. None is load-bearing for the core loop.

## Open questions

1. Self-hosted Geist plus one Source Sans 3 italic adds roughly 40 KB to an
   offline-first bundle. Worth it?
2. The derived plate is an ETL change, not a CSS change. In scope for a UI branch?
3. The species screen is the one genuinely new surface, and it answers the aisle
   question before a fish is yours. Worth building first?
