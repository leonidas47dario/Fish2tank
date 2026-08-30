# 017 — Fish Heaven becomes a place you can visit

**Status: requirements only. No code.** Written to be built after the catch
database redesign, because most of the open questions below are questions that
redesign will answer. See "What the catch redesign has to settle".

> A note on the name: the request says "Fish Haven"; the code and the shipped
> UI say **Fish Heaven**. This spec keeps "Heaven" throughout to match what
> exists. If Haven is the intended name, that is a rename worth doing
> deliberately and separately — it touches the screen, the specs and ENH-09.

## What was asked

> Right now, Fish Haven only records a single line, and there is no way to
> revisit those profiles or update them, which is not how I want it at all.
>
> I think we want to restructure Fish Haven into a setup similar to the tanks
> so that it supports pictures and essentially functions just like another
> tank. That way, users can review, edit, and even delete entries from Fish
> Haven (since some of it is junk data).
>
> To differentiate it so it does not feel like just another regular tank, we
> should add visual cues and specific memorial features:
> 1. A distinct visual marker, like a little wing icon.
> 2. Lifespan tracking: the date the fish was acquired and the date it passed away.
> 3. Spec tracking: log the initial length when acquired versus how big the fish was when deceased.
> 4. Memos: allow users to post notes or memories about the fish.
> 5. Multiple pictures: let users upload multiple photos spanning throughout the life of that specific fish.
>
> Ultimately, this should be a dedicated place where people can go to mourn
> their deceased fish and keep their memories alive.

## The problem

Fish Heaven is nine lines of JSX inside `Journal.tsx`. A memorial renders as
one card — name, date, story, cause, lesson — and that is all of it.

- There is **no route to a single memorial**, so there is nothing to link to,
  nothing to return to, and no surface on which to add anything later.
- Nothing can be **edited**. A date typed wrong stays wrong.
- Nothing can be **deleted**. ENH-09 made the *catch* deletable; a memorial on
  its own still is not, so junk data is permanent.
- No **photo** has ever been attachable to a memorial.

FR-L03 asks for "a gentle, dignified tone rather than a stats-heavy reward
screen", and the current screen honours that by being nearly empty. Dignified
and unusable are not the same thing.

## Requirements

Numbered so they can be argued with individually.

### FH-1 — Fish Heaven is a place, not a list row

`/heaven` is an index and `/heaven/:id` is a page, mirroring `/tanks` and
`/tanks/:id`. The Journal's Fish Heaven section becomes a way in rather than
the whole feature.

### FH-2 — It never reads as just another tank

The differentiation lives in **four** places, not one, because a single tinted
header is a decoration and wears off:

- its own route, never an entry in the tank list;
- a wing mark on every card and beside every heading;
- a header that reads as a **span of time** — *acquired → died* — where a tank
  header reads as capacity;
- the words: *remembering*, *together*, *the last photo*.

**Nothing on the page shows a stocking bar, a compatibility verdict, a tier
badge or a score** (FR-L03).

### FH-3 — Lifespan, without inventing a date

Show the date acquired and the date died, and the span between them.

**The acquisition date must never be fabricated.** See "Findings" below: the
obvious default is wrong. Where no honest source exists the page says **"not
recorded"** and offers a field. "Together for N days" appears only when both
ends are real.

### FH-4 — Size at acquisition and at death

Two optional length measurements, and a growth figure derived from them.
Growth appears **only when both are present**; one alone renders as itself
with the other marked not recorded, never as a growth figure. Mixed units
(in/cm) must compare correctly.

### FH-5 — Memos

Several notes per memorial, added at any time after the fact, newest first,
each individually deletable.

The existing `memorial.story` is **not** replaced or absorbed. It is the note
written in the moment of recording the loss and keeps its own place; the memos
are what gets added afterwards, which is the part that is missing.

### FH-6 — Multiple pictures across a life

Several photos per memorial, ordered by when they were taken, so the page can
show a fish across the time it was kept. Adding a photo must work for a fish
that never had a catch record — the imported inventory rows have none.

### FH-7 — Review, edit, delete

Every field in FH-3, FH-4, FH-5 and the existing story/cause/lesson is
editable after the fact, and an edit can **clear** a value, not only change it.

Deleting a memorial removes the memorial, its memos, and any keeper principle
written **from** it. It must **not** delete the fish, its tank history, its
photos, or the record that it died. A keeper clearing a mistyped memorial is
not asking to resurrect a fish or lose its pictures.

A principle with no source, or one sourced from a different fish, stays — a
lesson can outlive the record that taught it. This is the same rule ENH-09
settled for deleting a catch and the two must not disagree.

## Findings from a spike, worth keeping

An implementation was started and stopped. Four things it established are
worth not re-deriving:

### There is no wing in the icon set

Phosphor ships no `Wing`, and `Icons.tsx` holds the app to one family at one
weight — hand-drawing a single glyph breaks the only thing that makes the set
coherent. **`Butterfly` is the recommended substitute**: it is wings, it is in
the family, and it carries the remembrance association the request reaches
for. Recorded because it is a substitution, not the literal ask.

### The acquisition date has no honest default

The tempting default is `holding.createdAt`. For the 61 imported inventory
rows that is **the minute a spreadsheet was read in 2026** — it would render
as "together for 2 days" under a photo of a fish kept for three years.

Under today's model the honest ladder is:

1. what the keeper typed;
2. else the earliest encounter for the fish — the day it was caught;
3. else the earliest residency start — the day it entered a tank;
4. else *not recorded*.

**The catch redesign could remove this ladder entirely** by making acquisition
a first-class field. That would be a strictly better answer than deriving one.

### Photos should reuse the existing media machinery

Attaching memorial photos through the existing specimen/media path means the
media queue, the orphaned-blob sweep (BUG-06) and automatic sync (spec 014)
all keep working unchanged. A separate `memorialMedia` table would need its
own sync entry, its own sweep rule and its own backup coverage to hold the
same bytes.

### Schema changes must now be purely additive

Spec 005 FR-A06 records that Dexie cannot migrate a synced table consistently
on the client. New fields must be optional and new tables pure additions —
which is achievable for everything above, but constrains how the catch
redesign lands too.

## What the catch redesign has to settle

This is why the spec stops here rather than becoming code.

1. **What identifies one fish.** Today it is a holding plus an optional
   specimen, and a memorial hangs off `holdingId` with `specimenId` optional.
   The memorial's name, photos and dates all resolve through that pair. If the
   redesign collapses or replaces it, every join in this feature changes.
2. **Whether acquisition becomes a real field.** If it does, FH-3's derivation
   ladder collapses to reading one value, and this feature gets simpler and
   more truthful at once.
3. **Whether measurements get a home over time.** *Size at acquisition versus
   size at death* is the degenerate two-point case of "measurements over
   time". If the redesign gives a fish a measurement series, FH-4 becomes a
   view over it rather than two more columns — and the memorial page could
   show a growth curve for free. **Worth considering before FH-4 is built as
   two fields**, because two fields are hard to migrate into a series later.
4. **Whether "deceased" stays a life event.** FH-7's delete rule depends on
   the death record and the memorial being separable.

## Out of scope

- A shared or public memorial page. That is the tank-sharing request, and it
  carries an unsolved EXIF problem: NFR-04 requires stripping EXIF from shared
  derivatives, the app strips none today, and stored originals may carry home
  GPS coordinates. Filed separately.
- Changing how a death is recorded. `recordDeath` is unchanged by this.
- Bereavement prompts, anniversaries or notifications. Nobody asked to be
  reminded, and FR-L03's tone rules against it.

## Acceptance criteria

1. `/heaven` lists every memorial with a wing mark, name, date and photo.
2. `/heaven/:id` opens one; the Journal links to it.
3. The acquisition date comes from real evidence or says "not recorded", and
   never from a record-creation timestamp.
4. "Together for N days" appears only when both ends are real, and never as a
   negative number.
5. Growth appears only when both sizes are present, and mixes units correctly.
6. A memorial can be edited, an edit can clear a field, and it persists.
7. Several memos per memorial, newest first, each deletable.
8. Photos can be added to a memorial whose fish never had a catch record.
9. Deleting a memorial removes its memos and the principles sourced from it,
   and leaves the fish, its tank history, its photos and the death record
   alone.
10. Nothing on the page shows a score, a tier or a stocking bar (FR-L03).

## Requirements touched

FR-L02, FR-L03, FR-L04 (loss, tone, principles); FR-T02/T03 (holdings and
residencies as today's source of the dates); P6 (never invent a number).
