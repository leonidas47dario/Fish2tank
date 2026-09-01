# 025 — A shared tank is a door, not a room you cannot leave

**Status:** implemented.
**Date:** 2026-09-01.
**Touches:** FR-S02 (a shared tank renders without an account), FR-S06 (the tap survives the sign-in), FR-R10 (the catalog is where a species is read).
**Amends:** spec 023, which shipped the funnel's last step as dead code.

---

## What was asked

> I've discovered a bug, the share page asks user to sign up and login, but
> after logged it, it doesn't take the user to the actual app, but it just
> takes the user back to shared tank page. Ideally once logged in, the user
> should be able to click into fish profiles to go to the catalog, where before
> when not logged in, it should pop a blurred profile saying that to see more
> info please login

## The cause is not a redirect bug

Reproduced by reading, and it is more basic than "the redirect goes to the
wrong place". Three findings, each independently enough to produce the
reported behaviour.

### 1. A tile is not clickable at all

`SharedTank`'s `renderTile` returns a `<div>` carrying the content and a heart
`<button>`. **The heart is the only interactive thing on a tile.** There is no
route from a shared tank into a species profile, and never was — signed in or
signed out.

Spec 023's PR description said *"Hearting a fish, **or opening one**, asks for
an account."* The second half was never built. That sentence is why this reads
as a regression rather than a missing feature.

### 2. `action: 'profile'` is dead code that would misbehave if reached

`PendingIntent` allows `'heart' | 'profile'`, the validator accepts both, and
the consumer branches on both:

```ts
if (intent.action === 'heart' || intent.action === 'profile') {
  void heart(intent.speciesId);
}
```

Nothing anywhere creates a `'profile'` intent — `remember()` is called in
exactly one place, with `action: 'heart'`. So the branch has never run. If it
ever had, it would have **hearted the fish and stayed put**: a guest who asked
to *read* about a fish would have silently acquired a Dream List entry they
never asked for, which is a write performed on someone's account off the back
of a misread intent.

### 3. `/share/:token` renders outside the gate, forever

```tsx
<Route path="/share/:token" element={<SharedTank />} />
<Route path="/*" element={<GatedApp />} />
```

That is correct and deliberate (FR-S02) — a stranger must be able to open it.
But it is unconditional: **being signed in does not change what that URL
renders.** A guest who signs in is returned to `/share/:token` and sees the
shared page again, with no transition into the app and nothing offering one.
That is the reported symptom exactly, and it is the shared page behaving as
written.

## What changes

### A tile opens the fish

The tile content becomes a control. Signed in, it navigates to
`/species/:id` — the real catalog entry inside the app, not a copy. Signed
out, it opens the peek below rather than demanding an account first: being
asked to sign up before seeing anything is the thing everybody dismisses.

The heart keeps its own button and its own behaviour. Two different wants —
*I want this fish* and *tell me about this fish* — stay two different targets.

### The peek shows real data, blurred

The published snapshot already carries `adultSizeIn`, `minVolumeGal`,
`aggression`, `waterZone` and `unitPrice` per resident, so the peek blurs
values that genuinely exist rather than mocking up a tease.

**The blur is an invitation, not a lock, and the spec says so because the code
must not imply otherwise.** Those fields are in a public JSON file that anyone
holding the link can read directly. Blurring them is a UI affordance about
attention, not a security control, and nothing here should be described as
protecting them. What is actually behind the account is the *app* — the
Dream List, the tank you measure against, the compatibility read.

Follows the existing `.plate--locked` idiom rather than inventing a second
visual language for "there is more here".

### The intent replay navigates instead of hearting

`'profile'` now routes to `/species/:id`; `'heart'` still hearts. The two stop
collapsing into one, which also removes the unrequested write in finding 2.

### A signed-in reader is offered the way in

Even on the heart path, a guest who signs in lands back on the shared page.
That is right — they were reading a tank and should not be yanked out of it —
but it should not be a dead end, so a signed-in viewer gets an explicit link
into their own app. This is the smallest honest answer to "it doesn't take the
user to the actual app": offer the door, do not force them through it.

## Alternatives rejected

- **Redirect a signed-in visitor off `/share/:token` automatically.** It would
  fix the complaint and break the feature: a keeper who opens their own share
  link to check it, or a signed-in friend following a link, would never be able
  to see the shared page at all. A share link must render the share.
- **Demand sign-in on the first tile tap.** What happens today for the heart,
  and the reason the funnel leaks: an account request with nothing shown yet is
  a request to trust a stranger's link. The peek shows the thing first.
- **Render the full species profile inside the shared page for signed-out
  guests.** It would need the catalog, the market index and the care data in a
  page built for strangers, and would make the shared bundle answer questions
  the snapshot was deliberately kept small enough not to answer.
- **Deleting `'profile'` from `PendingIntent` as dead code.** It is not dead by
  accident; it is the half of spec 023 that was specified and not wired. Wiring
  it is the smaller change and the one the reporter asked for.

## Acceptance criteria

1. A tile on a shared tank is an activatable control.
2. Signed in, activating it lands on `/species/:id` inside the app.
3. Signed out, activating it opens the peek rather than a sign-in demand.
4. The peek shows the resident's real snapshot values, visually locked, and
   claims no more than that.
5. Signing in from the peek returns to the tank and then opens the profile —
   the intent navigates and does NOT heart.
6. The heart still hearts, signed in or after signing in, unchanged.
7. A signed-in viewer of a shared tank is offered a way into their own app, and
   is never redirected out of the shared page automatically.
8. `vitest run` and `npm run build` both green.
