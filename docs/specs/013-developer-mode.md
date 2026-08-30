# 013 — A way past the gate, and an honest account of how weak it is

## What was asked

> We also need a way to add a backend for you to bypass the login bypass,
> perhaps a developer mode button which requires a login secret

## The problem

Spec 010 put a sign-in gate in front of everything, for a good reason: a
logged-out device worked perfectly while silently accumulating catches, photos
and tanks somewhere that would not survive the device.

The side effect is that **nothing can drive the app without a Google account**.
That is not hypothetical — verifying spec 010's own wording required
neutralising `AuthGate.tsx` in a working tree, driving the flow, and reverting
it. Any check that has to be performed by editing the source and remembering
to undo it is a check that will eventually be skipped, or worse, shipped.

So: a deliberate, visible, reversible way in that leaves the gate intact for
everybody else.

## What this is, and what it is not

**It is a speed bump. It is not a secret, and this spec will not pretend
otherwise.**

The check runs in the browser, in a public repository. Only the SHA-256 of the
passphrase is committed, so the string itself is not published — but anyone
who wants in can read the bundle, set the localStorage key by hand, and skip
the passphrase entirely. Nothing about a client-side check can prevent that.

The reason that is acceptable here is **what developer mode actually gets
you**, which is very little:

- an app running **signed out**, with an empty local database and the bundled
  species catalog;
- **no** access to anyone's collection. Records live in Dexie Cloud behind a
  Google sign-in, and this does not touch that;
- **no** access to photos. Media lives in R2 behind the Worker's token check,
  and this does not touch that either.

Developer mode unlocks an empty app on the device it is typed into. If it
protected anything real, a client-side passphrase would be the wrong tool.

Two consequences worth stating plainly rather than burying:

1. The passphrase was sent in a chat message, and that transcript is written
   to disk. It should be treated as public and never reused anywhere else.
2. Rotating it is a one-line commit: replace `DEVELOPER_PASSPHRASE_SHA256`
   with a new digest (`node -e "console.log(require('crypto')
   .createHash('sha256').update(NEW,'utf8').digest('hex'))"`).

## In scope

- `src/data/dev-mode.ts` — the passphrase check (`crypto.subtle.digest`), and
  a `localStorage`-backed on/off switch.
- An understated disclosure at the bottom of the gate, closed by default, that
  opens a password field. It is not a second call to action competing with
  "Sign in with Google".
- **A banner that stays on screen for as long as developer mode is on**, on
  every route, saying that nothing is syncing and this device holds the only
  copy — with a control to leave. This is not decoration: spec 010 exists
  because a signed-out device *looked healthy* while accumulating data that
  could not survive. Reintroducing that state quietly would reintroduce the
  defect the gate was built to fix.
- Leaving developer mode returns you to the gate.

## Out of scope

- Any elevation of privilege. Developer mode signs nobody in and unlocks no
  remote data; it is exactly "the app as it behaved before spec 010".
- Server-side verification of the passphrase. There is no session to protect,
  so a round trip would add a dependency without adding a guarantee.
- Rate limiting. Guessing gets you an empty app; the effort is better spent
  elsewhere.

## Alternatives rejected

- **A build-time flag, so developer mode only exists in dev builds.** Cleaner
  in theory, useless in practice: the builds that need driving are the
  deployed UAT and production ones, which is precisely where the flag would be
  off.
- **An environment variable holding the hash, injected at build time.** A real
  improvement to rotation, and worth doing later. Not now: no repository
  secret is configured, so it would ship as an unset variable that silently
  disables the feature — a worse failure than a committed hash whose weakness
  is documented.
- **Storing "developer mode" in the database.** It is about this browser, not
  this collection — the same reasoning that keeps `muted` in localStorage.
- **No banner, just a quiet bypass.** Rejected outright. See above.

## Acceptance criteria

1. The correct passphrase opens the app, signed out.
2. A wrong passphrase says so and changes nothing.
3. Developer mode survives a reload.
4. The banner is present on every route while it is on, and names the risk.
5. Leaving developer mode returns to the gate immediately.
6. Nothing about the signed-in path changes: a signed-in user never sees any
   of this.
7. The plaintext passphrase appears nowhere in the repository.

## Verified in a browser

The feature exists to make browser verification possible, so verifying it any
other way would have been absurd. Driven against the production build:

| Check | Result |
|---|---|
| Gate shows on a fresh profile | `Fish2Tank` panel rendered |
| Wrong passphrase | "That passphrase does not match. Nothing has changed."; still gated |
| Correct passphrase | app opened, nav present, banner reading "Developer mode. Signed out — nothing is syncing…" |
| Banner on another route (`/tanks`) | present |
| Survives reload | present |
| "Leave" | back at the gate |

One defect this caught, which no test would have: the sticky banner covered
the profile button (FR-A10) — `position: fixed`, `z-index: 9`, `top:
var(--space-3)` — and took away the one control that used to be seven cards
down Settings. Fixed by having the banner **measure itself** into
`--devbar-height` and offsetting `.profile` by it, rather than hard-coding a
height that this text does not have: it wraps to two lines on a phone and one
on a laptop. Measured after the fix: banner 62px, button at y=74, clear.

The unit tests cover only the parts that have no DOM (the digest, and refusing
a wrong passphrase). The suite runs under node with no `localStorage` and no
`window`; buying a DOM environment for two booleans would have been worse than
driving the real thing.

## Requirements touched

- FR-A09 (the sign-in gate) — narrowed by an explicit, visible exception.
