# 041 — Fields you can actually type in

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** ENH-19, FR-C03, NFR-01 (a phone is the target device).
**Fixes:** a defect introduced by spec 039 and reported on the device it broke
on, plus an older one found while fixing it.

---

## What was reported

> Format looks better but there seems to be a bug, the system doesn't allow
> entering any info.

## The bug, and why the tests missed it

Spec 039's inline field rendered the value as a `<button>` and swapped in an
`<input>` when tapped, focusing it from an effect:

```
tap → setEditing(true) → React re-renders → useEffect → input.focus()
```

**iOS Safari opens the keyboard only when `focus()` happens inside the user
gesture that caused it.** By the time that effect runs, the gesture is several
turns in the past, so WebKit declines: the input appears, the keyboard does
not, and to a person holding the phone the field simply does not accept
anything. Which is precisely how it was reported.

It passed everything it was checked against, and that is the part worth
recording. `page.fill()` sets a value through the automation protocol and never
needs a keyboard. Chromium's `devices['iPhone 13']` profile emulates a
viewport, touch events and a user agent — **it is still Blink**, and Blink has
no such restriction. There is no WebKit build in this environment, so the one
engine that fails is the one that could not be driven.

**So the fix is not a WebKit workaround.** It removes the swap:

> The input is always the input. It is styled to read as a value rather than a
> form field, so a tap lands on a real focusable control and the keyboard opens
> because the browser decided to, not because the app asked afterwards.

There is now **no `focus()` call in the component at all**, which is the
property to hold on to: a class of bug that cannot happen beats one that is
handled.

## The second bug, which was already shipped

Checking font sizes while fixing the first: **every input in the app was 15px**,
because `input, select, textarea { font: inherit }` inherits the body's
`--size-md`.

iOS Safari zooms the page whenever a focused field is under **16px**. So the
search box, the price form, the measurement form and the tank form all shunted
the layout sideways on focus and left the reader to pinch back out — on the
only device this app is built for. Older than spec 039 and nothing to do with
it.

The floor goes on the base rule so it covers every field rather than the six
this spec touched: `font-size: max(1rem, var(--size-md))`. `max()` rather than
a flat `16px`, so a reader who has raised their browser's base size keeps it.

### And it caught the same mistake twice in one file

The first version of the new inline field carried `font-size: inherit`. That
selector is more specific than the base input rule, so it beat the floor and
inherited **13px** from `.factlist` — putting the iOS zoom back on the exact
fields this spec exists to make typable. Found by measuring every field on the
page rather than by reading the CSS.

The value now renders larger than its label, which is the better hierarchy
anyway: the label is the quiet half.

## Not done

- **Testing on real WebKit.** The gap that let this ship. Worth a note in
  `docs/RELEASING.md` that Chromium's phone profile does not cover the engine
  the app is actually used on.

## Acceptance criteria

1. No `focus()` call in the inline field component. ✅ (0 occurrences)
2. The inputs exist before any interaction — there is no swap. ✅ (6 present)
3. One tap focuses a field and typing persists across a reload. ✅
4. No field anywhere on the record is under 16px. ✅ (measured: 0)
5. The layout still holds: one line per label, no horizontal scroll. ✅
6. `vitest run` and `npm run build` green. ✅
