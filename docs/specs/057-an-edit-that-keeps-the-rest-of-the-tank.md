# 057 — An edit that keeps the rest of the tank (BUG-09)

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-E05, P6, NFR-05.
**Closes:** BUG-09, open since spec 022.

---

## What was asked

> If the bug is all fixed, we can push UAT into main.

They were not. BUG-09 was still open, and checking it rather than assuming is
what this spec is.

## The reported defect

`TankForm.save()` handed `db.aquariums.update()` all four fields on every save:

```ts
await db.aquariums.update(aquarium.id, {
  name: trimmed,
  volume: gallons ? { value: Number(gallons), unit: 'gal' } : undefined,
  dimensions: dims,
  stockingState: stocking || undefined,
});
```

**Dexie deletes a property given `undefined`.** So an edit to the *name* took
`dimensions` and `stockingState` with it whenever those boxes were blank — and
the footprint is what the swim-space and minimum-footprint screening rules
read. This is the same shape as BUG-16 in `updateCatch`, fixed there by
patching only the keys the caller mentioned.

## The second defect, found while fixing the first, and arguably worse

The units are **hardcoded on write and ignored on read**:

```ts
const [gallons] = useState(aquarium.volume ? String(aquarium.volume.value) : '');
// …
volume: gallons ? { value: Number(gallons), unit: 'gal' } : undefined,
```

A tank held in litres was shown its litre figure under a box labelled "Volume
(gallons)", and saving wrote that number back as gallons. **200 L becomes
200 gal.** The same applies to a centimetre footprint written back as inches.

That is worse than the deletion it was found beside. A deleted footprint makes
the screen say *"not enough data"*, which is true and visible. A relabelled one
makes it say a confident wrong number — 3.79× on volume, 2.54× on each edge, in
the direction that makes a tank look **bigger** than it is, which is the
direction that turns an overstocking warning into a pass.

## The fix

The rule moves to `domain/tank-form.ts`, pure and tested, and the screen only
applies the patch it returns:

- **Only what actually changed.** An empty patch writes nothing at all, so an
  unrelated edit cannot clear a field as a side effect.
- **The stored unit is carried**, never the label's. A tank in litres stays in
  litres.
- **A partial footprint is no footprint**, not a smaller one: all three edges
  are needed or the field is cleared.

**Blanking a box the keeper actually filled is still a real clear.** P6 treats
"I do not know this" as an answer, and a form that refused to un-set a value
would be a different bug.

## The half the domain rule cannot cover, and where it went instead

`tankFormPatch` cannot tell "the keeper blanked this box" from "this box was
never filled in", and it must not try — those must produce the same write.

So the protection for the second case lives where the form is built.
`useState(initial)` reads its argument **only on first mount**, so a form
reused across two tanks, or mounted before its tank had loaded, keeps the first
tank's boxes. `<TankForm>` is now keyed on `aquarium.id`, which forces a
remount so the boxes always start from the tank on screen.

Both halves are asserted, including the failure: one test drives an unseeded
form and asserts it *does* clear, so the reason the key matters is written down
rather than implied.

## Acceptance criteria

Nine tests over the pure rule.

1. Renaming a tank writes only the name. ✅ — the patch is `{ name }` and
   carries no `dimensions`, `volume` or `stockingState` key at all.
2. A tank stored in litres or centimetres keeps its unit through an edit. ✅ —
   `200 l` edited to `250` writes `{ value: 250, unit: 'l' }`, not `gal`.
3. An unchanged form writes nothing. ✅ — `update()` is not called.
4. Blanking a filled box still clears the value. ✅
5. A half-filled footprint clears rather than storing two edges. ✅
6. The form cannot carry another tank's values into a save. ✅ — via the
   remount key, with a test that pins *why* by asserting an unseeded form does
   clear.
