# 042 — Keeping the fish

**Status:** implemented.
**Date:** 2026-09-02.
**Touches:** ENH-19, FR-T02, FR-T03 (a move closes one residency and opens the
next), PRD 4.4.

---

## What was asked

> Some feedback on if it comes home section. It should instead say: "Keeping
> the fish", with one tank option. It shouldn't let user to add more, but it
> should allow user to move the fish between tanks in this page.

## "If it comes home" was written for a fish you had not bought

The heading is a conditional, and it made sense on a record that was almost
always a shop sighting: *a catch is documentation, not acquisition*. But by the
time the section shows a tank the condition has already resolved — the fish
lives somewhere, and the panel is still phrased as a hypothetical about it.

**"Keeping the fish"** describes what the section is for once it has an answer,
and reads correctly before it has one too: this is where keeping gets recorded.

## One tank, and a move rather than a second holding

The old panel offered **"Also add to another tank"**, which minted a second
holding of the same species. That is a real modelling capability — six tetras
split across two tanks genuinely are two holdings, and the inventory import
produces exactly that — but it is the wrong offer on a **specimen's** record.

This page is about one fish. A fish is in one tank. Offering to put it in a
second is offering to create a second animal, which is not what the button
looked like it did.

So the control becomes a **tank picker that moves it**. `moveHolding` already
does the right thing and has since FR-T03: it closes the current residency,
opens the next, and writes a `moved` life event — which now also lands in the
timeline, so where a fish has lived becomes part of its history rather than
only its current state.

**`stockTank` is untouched**, and the tank screen keeps its own "add a fish".
Stocking a tank is a tank's question; this is the fish's page.

### What happens to a record that already has two holdings

It renders both, each with its own picker. Hiding the second would be tidier
and would mean a keeper could see a fish in the tank list that its own record
denied being in.

There is no way to create that state from here any more, but the inventory
import can, and `StockAnotherTank` could until this change. Data that exists
gets shown.

## Deliberately unchanged

- **`stockTank` and the tank screen's "add a fish".** Above.
- **Quantity.** A holding's count changes through life events — a death, a
  birth, a correction — not by typing over it, and `deriveQuantity` computes
  it from those. A number that looks editable but is derived would be worse
  than one that plainly is not.
- **Removing a fish from every tank.** That is `removeHolding`, and it belongs
  with the flows that record a fish leaving rather than beside a tank picker.

## Acceptance criteria

1. The section reads "Keeping the fish". ✅
2. Its tank is a picker, and changing it moves the fish. ✅ (browser: Deep Sea Collector → Peaceful Garden, surviving a reload)
3. A move writes a `moved` life event, which appears in the timeline. ✅ ("Moved tank")
4. There is no way to add the fish to a second tank from this page. ✅ (0 matches for the old control)
5. A fish not yet in a tank can still be put in one. ✅ (`BringHome` / `PlaceHolding` untouched)
6. A record that already holds two shows both. ✅ (one picker per holding)
