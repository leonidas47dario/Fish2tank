# 039 — The record is about this fish

**Status:** design; built in two parts.
**Date:** 2026-09-02.
**Touches:** ENH-12, ENH-19 (this feedback), FR-C03 (correct the record),
FR-J01, PRD 4.3–4.7, P3 ("the exact specimen matters").

---

## What was asked

> The fish specific log is very messy, it should be dedicated to the specimen
> rather than more redundant info about this species. The following features
> shouldn't be here at all:
>
> 1. Tank analysis
> 2. Market price info
> 3. Discovery
> 4. Edit button (this is the most dump design, everything should be editable
>    and not through the edit this catch button, it's very redundant and not
>    useful)
> 5. The timeline, if more photos are added, should embed the photos inside
>    the timeline.
> 6. Timeline should be editable to enable backfilling

## The principle, and the test it gives

One sentence carries the whole change: **the record is dedicated to the
specimen rather than to the species.** That is a test any future section can be
held against —

> Is this fact about *this fish*, or about *fish like this one*?

Principle P3 already says "the exact specimen matters", and the page had drifted
into being a species encyclopaedia with a photograph at the top. Every removal
below is the same removal.

Two of the three panels already have a home on the species page, which is where
a question about the species belongs. **The third does not**, and that is worth
stating plainly rather than discovering later — see below.

## The three that leave

| Panel | What it answers | Whose question |
|---|---|---|
| **Your tanks** | would a fish like this suit my tanks? | the **species** |
| **Discovery** | how rare is this kind of fish? | the **species** |
| **Size and price** | what do fish like this sell for? | the **species** |

The tank screening is the one worth arguing about, because it feels
specimen-shaped: *should I buy **this** fish?* But every input is a species
fact — adult size, aggression, minimum volume — and the verdict for two
severums in the same tank is identical. It reads as being about the fish in
front of you and is not.

### Tank screening loses its only surface, and that needs saying

Checked rather than assumed: the market panel and the Discovery badges are
already on the species page, so removing them from the record removes a
*repeat*. **Tank screening is not.** `SpecimenDetail` is the only screen in the
app that renders it, so this removal takes the compatibility engine — PRD 5.1
and 5.2, one of the product's core promises — off the screen entirely.

It is removed anyway, because it was asked for and it is genuinely
species-shaped. But it is removed **as a move that has not landed yet**, not as
a deletion, and the engine, its tests and its stored assessments are all
untouched.

Giving it a home is not a five-line lift, which is why it is not smuggled in
here: `evaluateSpecimen` is keyed on a specimen and writes assessments against
one, and the useful version of the question — *"should I buy a fish I do not
own yet?"* — has no specimen to key on. That is a design question with a real
answer to work out, and it is filed rather than guessed at.

### What "Size and price" splits into, because it is two things

The panel mixed the two kinds of fact the principle separates, so it does not
leave whole:

- **What you paid, where, and when — stays.** That is a fact about this exact
  animal and exists nowhere else in the app.
- **The market estimate, the price-fit verdict, the scarcity band — go.** Those
  are the species' market, identical for every specimen of it.

Keeping the paid price under a heading that no longer says "price" would be
tidiness winning over usefulness; it moves into the record's own facts, beside
where and when the fish was met.

## 4 — "Edit this catch" was the wrong shape

The strongest wording in the feedback, and it is deserved.

A page with an **Edit button** says: *what you can see is not what you can
change; the real version is behind here.* So the same fact appears twice — once
rendered, once in a form — and the two drift. The label, the date and the place
were each displayed in one place and edited in another.

**Every field edits where it is displayed.** Tap the value, change it, it
saves. No mode, no second copy, no button whose only job is to reveal the
truth.

This is FR-C03 ("correct the record") unchanged in what it permits and changed
in how it is reached. The delete panel is **not** folded in: deleting is not
correcting, it is the one action with no undo, and it keeps its confirmation.

## 5 and 6 — the timeline becomes the record's spine

The two timeline asks are one idea. A timeline you can only read is a report; a
timeline you can correct is where the record actually lives.

### Photographs render in it

A row that says "Photographed" and shows nothing is a caption for an absent
picture. Spec 036 derived the thumbnails and taught the app to read them, so
the cost of drawing one here is a 320-pixel blob already on the device — the
change is affordable *because* of spec 036, and would not have been a week ago.

### Every entry can be corrected

*"Editable to enable backfilling"* is the sharper half. A collection that
predates the app has decades of history and no dates the app can trust:

- a **photograph's date** is `capturedAt`, which for an imported or re-saved
  file is the moment it was stored, not when it was taken;
- a **measurement** typed with the wrong digit stays wrong;
- a **life event** — came home, moved tank — may be known to the month and
  recorded as today.

So each row gains a correction, and correcting a photo's date is what makes the
timeline true rather than merely populated: it is the entry that feeds the
acquisition ladder's third rung.

**Backfilling does not weaken P6.** A date the keeper typed is evidence — the
first rung of spec 037's ladder. What P6 forbids is the *app* inventing one,
and nothing here does: the fields start from what is stored and an empty answer
stays empty.

## Two pull requests

**A — the declutter.** ✅ Remove the three species panels, split the paid price
out, and replace the edit button with inline editing. Net **-323 lines** from
`SpecimenDetail.tsx`, which is the honest measure of how much of that screen
was answering somebody else's question.

The record now reads: History · Identity · About this species · What you paid ·
Story · If it comes home · Delete. `SpeciesBrief` ("About this species") stays:
it is two lines of context under the name rather than a panel, and it was not
in the ask.

**B — the timeline.** Embed photographs, and make every entry correctable.

Split because they are independently reviewable and A is what makes the page
readable enough to judge B in.

## Deliberately not here

- **Removing anything from the species page.** All three panels already live
  there. This is about where they are *repeated*.
- **Editing a life event's type.** Correcting a date is backfilling; changing
  "moved" to "died" rewrites what happened and belongs with the flows that
  record those.
- **Deleting a photo from the timeline.** It already has a home on the record,
  with a confirmation, from spec 033.

## Acceptance criteria

### A — the declutter

1. Tank screening, Discovery and the market panels do not appear on a
   specimen's record. ✅ (browser)
2. The market panel and Discovery remain reachable on the species page. ✅
   **Tank screening does not** — it had no second home, and finding it one is
   its own change, filed, not folded in here. ⬜
3. What you paid, where and when survives on the record. ✅
4. No "Edit this catch" button; every editable field edits in place. ✅ (browser: zero edit buttons, an inline change survives a reload)
5. Deleting still sits behind its own confirmation. ✅
6. Nothing that was recordable before becomes unrecordable. ✅ — and a note
   on an OLDER chapter is now reachable, which the edit form never allowed.

### B — the timeline

7. A photo entry shows the photograph, at thumbnail cost. ⬜
8. A photo's date can be corrected, and the timeline reorders. ⬜
9. A measurement can be corrected or removed. ⬜
10. A life event's date can be corrected. ⬜
11. A corrected acquisition date re-anchors the relative labels. ⬜
12. Clearing a field leaves it empty rather than substituting a guess. ⬜
