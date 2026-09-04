# 046 — Fish Heaven is a place you can visit

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-L02, FR-L03, FR-L04 (loss, tone, principles), FR-T02/T03,
FR-J01, P6.
**Supersedes:** the proposal in PR #49, whose seven requirements are carried
here rather than left in an unmerged branch.
**Builds on:** spec 037, which is what makes the reimagining possible.

---

## What was asked

Originally:

> Right now, Fish Haven only records a single line, and there is no way to
> revisit those profiles or update them, which is not how I want it at all. …
> restructure … so that it supports pictures and essentially functions just
> like another tank … a distinct visual marker … lifespan tracking … spec
> tracking … memos … multiple pictures.
>
> Ultimately, this should be a dedicated place where people can go to mourn
> their deceased fish and keep their memories alive.

And, when it came time to build:

> I'd like fish heaven reimagined, has useful and meaningful features. I think
> it's ready to build that now

"Ready now" is the accurate part, and it is worth saying why: **spec 037 built
the thing this feature was waiting for.** PR #49 deliberately stopped at the
spec stage because four of its open questions were questions the timeline would
answer. It has.

## The reimagining, in one sentence

Spec 037 ended with a claim this spec now has to make good on:

> **Fish Heaven is the index of timelines that ended**, rather than a second,
> parallel store of facts about dead fish.

That is the whole design. A memorial is not a card with a date on it — it is
**a fish's whole timeline, with an end**. Everything below follows from taking
that literally rather than treating it as a nice phrase.

The practical consequence: this feature adds **almost no new storage**. The
life events, the photographs, the measurements and the memorial itself are all
already written, and already dated. What was missing was a place to read them.

## What each requirement becomes, given a timeline exists

| PR #49 | Was going to be | Is now |
|---|---|---|
| FH-3 lifespan | derive a date from an evidence ladder | `Holding.acquiredOn`, a real field (spec 037) |
| FH-4 size at acquisition vs death | **two new columns on `Memorial`** | first and last of the measurement series, via `lengthSpan()` |
| FH-6 several pictures across a life | a `memorialMedia` table | the specimen's media, already dated, already in the timeline |
| FH-5 memos | notes on a memorial | **dated notes on the holding** — see below |

FH-4 is the one that justifies the wait. Shipped as two columns it would have
been painful to migrate into a series afterwards, and FR-A06 would have made it
worse. As a query over data that already exists, it also means **a fish
measured three times has a growth story, not a before-and-after.**

## The one new record, and why it is not keyed on the memorial

FH-5 asks for memos: several notes per memorial, added at any time.

Keyed on `memorialId` that is a feature of one screen. Keyed on **`holdingId`**
it is a dated note on a fish, which:

- lands in the timeline beside the photographs and events, in date order,
  because that is where a dated observation belongs;
- works for a **living** fish too — "moved him because the barbs were nipping"
  is worth writing down long before anything dies;
- needs no special case when the fish dies, because nothing about it was ever
  about death.

```ts
export interface KeeperNote {
  id: Id;
  holdingId: Id;
  writtenOn: CalendarDate;
  text: string;
  createdAt: Instant;
}
```

`Memorial.story` is **not** replaced or absorbed, exactly as PR #49 required:
that is the thing written in the moment of recording the loss, and it keeps its
own place at the head of the page. The notes are what gets added afterwards,
which is the part that was missing.

## FR-L03 is the hardest constraint here, so it is stated first

> a gentle, dignified tone rather than a stats-heavy reward screen

A page that says *"kept for 412 days · grew 1.8 in · 3 photographs"* has turned
a dead animal into a dashboard. But a page that says nothing is the current
one, which the keeper rejected.

The line this spec draws: **every number on the page is a fact about the animal,
and none of them is a score.** How long they were with you and how big they got
are things a keeper remembers on their own; a tier, a rarity band, a
completion percentage or a comparison against another fish is not, and none of
those appears here. There is no leaderboard, nothing is ranked, and nothing is
totalled across fish.

Growth in particular renders as *"2.1 in → 2.8 in"* rather than *"+33%"*,
because the percentage is the version that reads as a performance.

## Differentiation lives in four places, not one

Carried unchanged from PR #49, because it was right: a single tinted header is
a decoration and wears off.

- **its own route** — `/heaven` and `/heaven/:id`, never an entry in the tank list;
- **a wing mark** on every card and beside every heading. Phosphor ships no
  `Wing`, and `Icons.tsx` holds the app to one family at one weight, so this is
  `Butterfly` — wings, in the family, carrying the remembrance association.
  Recorded as a substitution rather than the literal ask;
- **a header that reads as a span of time** — acquired → died — where a tank
  header reads as capacity;
- **the words**: *remembering*, *together*, *the last photograph*.

## Where P6 bites

**"Together for N days" appears only when both ends are real.** `acquiredOn`
where the keeper recorded one, else an `acquired` life event, else the earliest
photograph **labelled as a lower bound** — *"photographed since March"* — else
nothing at all. `holding.createdAt` is never used: for the 61 imported rows it
is the minute a spreadsheet was read in 2026, and a fish kept three years would
render "together for 2 days".

`daysBetween` already refuses a negative span, so a mis-typed date renders as
absent rather than as "together for -4 days".

**Growth appears only when there are two measurements.** One is a size, not a
growth; `lengthSpan` returns a single end in that case and the page says so.

## Deleting a memorial removes the record of the death, not the fish

Its memos and the principles written **from** it go. The fish, its tank
history, its photographs and the `deceased` event stay. Somebody clearing a
mistyped memorial is not asking to resurrect a fish or lose its pictures — the
same rule ENH-09 settled for deleting a catch, and the two must not disagree.

A principle with no source, or one sourced from a different fish, stays. A
lesson can outlive the record that taught it.

## Not done here

- **A shared or public memorial page.** That is the tank-sharing request and it
  carries an unsolved EXIF problem: NFR-04 requires stripping EXIF from shared
  derivatives, the app strips none, and stored originals may carry home GPS.
- **Changing how a death is recorded.** `recordDeath` is untouched.
- **Bereavement prompts, anniversaries or notifications.** Nobody asked to be
  reminded, and FR-L03's tone rules against it.
- **A growth chart.** Two measurements are a line, not a chart, and spec 037
  already deferred this deliberately.

## One thing this found that was already broken

`SpecimenDetail` rendered the History section only when the timeline already
had entries. An **opening-balance holding has none by construction** — no life
event, no photograph, no measurement — which is every one of the 61 imported
inventory rows. So the section vanished for exactly those fish, taking the only
way to record a measurement *or* write a note with it, and the empty state
written for that case ("nothing dated yet") was unreachable. The guard is now
just "is this fish kept", which is what the comment beside it always claimed.

Two smaller things on the same page, both visible in the verification
screenshots: `+1 days` now reads `+1 day`, and the quantity delta beside a life
event is shown only for a group. On a single fish it is always ±1 and
distinguishes nothing — and "Died -1" beside a memorial is a cold way to print
a fact the reader already has, which is FR-L03's whole concern.

## Acceptance criteria

Verified in a real browser against the built bundle, on a 390px viewport, with
a seeded fish acquired 2024-03-11, measured twice, moved between two tanks,
photographed twice and memorialised on 2026-02-20.

1. `/heaven` lists every memorial with a wing mark, name, date and photograph. ✅
2. `/heaven/:id` opens one, and the Journal links to it. ✅ — the Journal's
   own list is gone, replaced by three names and a way in; the memorial row in
   any other fish's timeline also links here.
3. The page shows that fish's whole timeline, ending at the memorial. ✅ —
   8 rows, the story printed once at the head rather than twice.
4. "Together for N days" appears only when both ends are real, and never
   negative. ✅ — rendered "Mar 11, 2024 — Feb 20, 2026 · Together for 1 year
   and 11 months"; `daysBetween` refuses a negative span and `summariseLife`
   refuses to invent a start.
5. Growth shows only with two measurements, as two sizes rather than a
   percentage. ✅ — "1.1in → 1.9in".
6. A dated note can be added, appears in the timeline, and can be removed. ✅ —
   a note dated 2025-06-01 sorted between the Jan 2026 and Mar 2024 entries,
   which is the backfilling case.
7. A note works on a living fish too. ✅ — and see above for what had to be
   fixed before it did.
8. The story, cause, contributors and lesson are all editable in place. ✅ —
   an edited story survived a reload.
9. Deleting a memorial keeps the fish, its photographs and the death event. ✅
10. No score, tier, rarity band or ranking appears anywhere on the page. ✅ —
    asserted against the rendered text, not by reading the source.
11. The new table is exported, erased and synced. ✅ — `EXPORTED_TABLES`,
    `ERASED_TABLES`, and synced by being absent from `UNSYNCED_TABLES`.
