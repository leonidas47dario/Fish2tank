# 010 - An account becomes required, and gets somewhere to live

**Status:** designed and built
**Date:** 2026-08-30
**Touches:** spec 005 FR-A02/FR-A04/FR-A05, PRD 2.2 and 3.2 (navigation model), NFR-02 (offline), NFR-06 (accessibility), FR-O01.
**Claims:** FR-A09 (an account is required), FR-A10 (the profile affordance).
**Reverses:** spec 005 FR-A05 and its acceptance criterion 4.

---

## What was asked

Verbatim, immediately after signing in successfully on UAT for the first time:

> "okay, signin worked! But it was really unintutivie, I want a user profile
> icon on the top right cornor for this setting, and if user is not logged in,
> the app should NOT FUNCTION. it should require user to login first."

Two requests. The first is a navigation gap. The second reverses a decision
spec 005 argued for at length, so most of this document is about that.

## The problem behind it

**Sign-in was buried.** It shipped inside Settings, below the theme pickers,
the scene pickers and the motion toggles. PRD 3.2's navigation model has five
bottom destinations and no header at all, so there was nowhere else for it to
go and nobody put it anywhere else. "Unintuitive" is generous: the single most
consequential control in the app was the seventh card down a settings page.

**Being signed out is a trap, not a freedom.** Spec 005 FR-A05 said "an
account is not a gate", and the reasoning was sound in the abstract: PRD 2.2
requires the product to be complete for one person, and gating a local-first
app behind a login is usually a mistake.

What that reasoning missed is what a logged-out device actually does now that
sync exists. It works perfectly. It accepts catches, photos, tanks and prices,
and it silently accumulates all of them somewhere that will not survive the
device. **The lost-phone scenario that justified this entire feature is
exactly the state the app was leaving people in by default,** while looking
completely healthy. An affordance whose failure mode is invisible and
permanent is worse than an affordance that asks a question up front.

## Design

### FR-A09 - An account is required, but connectivity is not

The app renders a sign-in screen instead of its routes when there is no
account. No route is reachable around it, and there is no skip.

**The gate tests for a cached identity, not for a working network.** This is
the difference between the requirement Ryan asked for and a requirement that
would break his primary use case. Logging a catch happens *in a fish store*,
and fish stores have bad signal. Dexie Cloud persists the login in IndexedDB
with a non-exportable keypair, so `db.cloud.currentUser` resolves offline from
the last successful sign-in. A device that has ever signed in therefore keeps
working with no connection at all, indefinitely. Only a device that has
*never* signed in is stopped, and that device has nothing to lose yet by
definition.

Implemented as our own gate with `requireAuth: false` still set on the addon,
rather than by flipping `requireAuth: true`. Two reasons: the addon's built-in
login dialog is unstyled and would arrive in the middle of the app's own
visual language, and a gate we render is a gate we can explain, which matters
when the answer to "why can I not get in" is "you have never signed in on this
device".

**NFR-02 is preserved in substance and narrowed in letter.** "Works offline"
now means "works offline once set up", which is what it means for every other
app on the phone.

### FR-A10 - The profile affordance

A circular button fixed to the top right, on every screen, showing the
keeper's initial when signed in. It goes to Settings, where the Account card
already lives.

It is a *link to the setting*, not a menu. A dropdown would be a second
navigation model competing with PRD 3.2's five destinations, for one
destination. If it earns more items later it can become one.

The bottom nav is untouched. It has five slots, Catch is deliberately the
centre one, and adding a sixth would break the grid and the product's one-verb
emphasis. Top right is empty, is where every other app puts this, and costs
nothing structurally because no header exists to disturb.

### What signing out does

Nothing destructive, and it returns you to the gate. The local database is
left exactly as it is, so signing back in resumes rather than re-downloads.
This is stated in the UI because "sign out" reads as "delete my stuff" to
enough people to be worth one sentence.

## Out of scope

- Any change to what syncs. Media still does not; that is the Worker's job.
- A dropdown menu, an avatar image, or anything beyond an initial.
- Multiple accounts on one device, or switching between them.
- Deleting an account or its data from the cloud.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `requireAuth: true` on the addon | Its dialog is unstyled and arrives in the middle of the app's own language. A gate we render is one we can explain. |
| A sixth bottom-nav item | Five slots with Catch deliberately central. A sixth breaks the grid and dilutes the one verb. |
| Keep FR-A05, add a "not backed up" warning banner | Considered seriously. Rejected because a banner is a thing people learn to ignore, and the failure it warns about is permanent. Ryan asked for the strong version and the strong version is defensible. |
| Gate on connectivity as well as identity | Would lock him out of logging a catch in a shop with no signal, which is the app's primary moment. |

## Acceptance criteria

1. A device that has never signed in shows the sign-in screen and no app route
   is reachable, including by typing a hash route directly.
2. A device that has signed in and is then taken fully offline still opens,
   still logs a catch, and never shows the gate.
3. Signing out returns to the gate and deletes no local data; signing back in
   resumes without re-downloading.
4. Every screen shows the profile button in the top right, and it reaches
   Settings in one tap.
5. The button shows the keeper's initial, and falls back to a generic person
   icon when no display name is set.
6. The button is reachable by keyboard, has an accessible name that says who
   is signed in, and does not overlap any screen's `h1`.
7. Spec 005's acceptance criterion 4 is struck through and points here, rather
   than being deleted.
