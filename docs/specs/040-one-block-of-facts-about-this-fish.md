# 040 — One block of facts about this fish

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** ENH-19, FR-C03, NFR-01 (a phone is the target device).
**Corrects:** spec 039's layout, on the first screenshot of it.

---

## What was asked

> I like the new meta data section, with some feedback:
> 1. It's too cramped for phone
> 2. It can probably be consolidated with other fields as well, such as nick
>    name, price log.

## 1 — The layout was inherited and it did not stretch

Spec 039 put the record's own facts in the header and made them editable in
place. Both right. It reused `.label-line` to lay them out, which is:

```css
display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
```

Five equal columns. That class was built for **three short items** — Caught,
Size, Chapters — and spec 039 gave it **six longer ones**. On a 390px phone
each column is about 70px, so "The store's label" wrapped to three lines and
its value wrapped underneath. The screenshot showed it immediately.

**Rows, not columns.** Label beside value, one fact per line. The label column
is sized in `ch` so it fits the longest heading without anyone measuring one,
and below 22rem — a small phone, or a large font — they stack, because a 14ch
label crushed against a value is worse than a label above it.

One label still wrapped after the change: *"Size when seen (inches)"*, at 23
characters against a 14ch column. It is **"Size (in)"**. Found by measuring
each heading's rendered height rather than by looking at it, because looking at
it is how the first version passed.

## 2 — Three sections were one record

The nickname sat in **Identity**, the price under **What you paid**, and the
rest in the header. All three are facts about this exact animal, so a reader
held one record in three places.

They are now one list. The consolidation is the same argument spec 039 made for
removing the species panels, applied in the other direction: the page is about
this fish, so the things that *are* about this fish belong together.

**The nickname leaves Identity deliberately.** Identity answers *which species
is this*, and does it with a confirmed label, a confidence statement and a
change control. What you call the animal is not part of that question.

### The price is folded in but stays read-only there

The figures render as rows; the form that writes one moves behind a
disclosure.

That is not an oversight of "everything should be editable". **A price is a
dated observation of what a shop asked, not a mutable field.** Editing the
number in place would rewrite what a shop charged on a day, silently. The way
to change it is to record another, which is what the form does, and what
`recordPrice` has always modelled.

Asking and Paid stay separate rows, and Member still renders when a record
carries one, because PRD 5.4 keeps the three apart on purpose.

## Not done

- **Making the size unit selectable.** It is inches everywhere the app asks a
  keeper for a length; a per-field unit picker is a change to make once, across
  all of them, not here.
- **Collapsing Identity into the list.** It is a different question with its
  own control, and merging it would undo the point of the section.

## Acceptance criteria

1. No label in the block wraps at 390px. ✅ (measured: max 1 line)
2. Nothing scrolls horizontally at 390px or 320px. ✅
3. The nickname is in the block, not in Identity, and editing it persists. ✅
4. The price figures are in the block; recording a new one is still possible. ✅
5. Asking, Member and Paid stay distinct. ✅
6. `vitest run` and `npm run build` green. ✅
