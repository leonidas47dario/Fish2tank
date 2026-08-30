# 014 — Photos sync on their own

## What was asked

> Seems like there is another issue: when I did actions that upload photos, it
> seems like the photo sync didn't happen. Can we find a way to make the photo
> sync more automatic rather than manual? I think we could add a trigger to all
> photo modifying actions to run a sync. If that's difficult, we can add an
> every 30min sync.
>
> And the 30min sync should be configurable

## The problem

Photo sync was manual by design, and the design said so out loud in
`AccountPanel.tsx`:

> Runs on demand rather than automatically for now: the first upload of a
> whole library is a deliberate act, not something to start unasked on a phone.

That reasoning was about the *first* upload of an existing library. It was
never a reason for the second photo, or the two hundredth, to sit on one
device until somebody remembers to open Settings and press a button. Records
sync on their own; photos did not; and the gap between the two is invisible
until the phone is lost.

**One thing this does not fix, and it must be said plainly:** on production,
photos would not have synced even with this change, because production's media
Worker has never been deployed (spec 011). Automatic sync makes the attempt
happen without being asked. It does not make it succeed. Production needs
`worker/setup-production.sh` run first.

## The trigger: watch the data, not the callers

The ask proposes "a trigger to all photo modifying actions". Rejected, in that
form. There are at least six such call sites today (`createCatchDraft`,
`addPhotos`, `setTankPhoto`, `clearTankPhoto`, `deleteCatch`, `deleteTank`),
every one of them would have to be kept in step by hand, and a seventh added
next month would silently not sync. That is the exact drift BUG-06 was made
of, where four delete sites each remembered to delete an original and all four
forgot previews and thumbnails.

Instead, **observe the table**. A `liveQuery` over `db.media` reports both the
row count and how many rows still owe bytes, and a change in either requests a
run. That catches every writer that exists, every writer added later, and one
case instrumented call sites would have missed entirely: a media row arriving
*from another device*, which is precisely when this device should be
downloading.

## What else asks for a run

- **A timer**, at the configured interval. This is the safety net for anything
  the observer cannot see - a failed earlier attempt, a Worker that came back.
- **Coming back online.** `navigator.onLine` going true is the single most
  likely moment for a queued photo to succeed.
- **The tab becoming visible.** A phone that was in a pocket for an hour did
  not run its timers; this is how it catches up on being opened.

All four go through one debounced request, so importing forty photos is one
run, not forty.

## Pausing, and why it is not a retry loop

Spec 011 taught this the expensive way: a screen said "28 failed" and promised
a retry against a Worker that had never been deployed, so every retry failed
identically forever while the UI said otherwise. An automatic loop makes that
worse — it would fail silently, on a schedule, on battery.

So a run that comes back with `configurationFault` **stops the automatic
loop**. Not the manual button, which is how somebody checks whether the
deployment landed; just the unattended part, which cannot succeed. The pause
is visible in Settings with the reason, because a paused loop nobody can see
is the same defect wearing a different hat.

Ordinary failures do not pause anything. A photo that failed on a bad
connection is exactly what the timer is for.

## Configuration

`photoSyncMinutes` on `UserSettings`, defaulting to **30** as asked, with
**Off** available for anyone who wants the old manual behaviour back. Off
disables the timer only — the change-triggered run still happens, because a
photo taken thirty seconds ago is the one most worth saving and it costs one
request.

Account-level rather than per-device, alongside `currency` and
`reducedMotion`, so it follows the person. `muted` is the counter-example and
stays in localStorage because it is about the room a device is in; a sync
cadence is about how the collection is kept.

Optional on the type, so no migration is needed and existing profiles simply
read the default.

## In scope

- `src/data/sync/auto-sync.ts` — the scheduler: debounce, coalescing,
  in-flight guard, interval, pause-on-configuration-fault, and a subscribable
  state.
- `src/ui/useAutoMediaSync.ts` — the glue that connects the liveQuery, the
  browser events and the setting to it, mounted once in `App`.
- Settings: the interval picker, the last automatic run, and the pause with
  its reason.

## Out of scope

- Background sync when the app is closed. That is a service-worker
  `periodicsync` job with its own permission story, and no browser Ryan uses
  grants it to a non-installed site.
- Uploading on a metered connection differently from wifi. `navigator.connection`
  is not carried by Safari, so any rule built on it would be honoured on some
  devices and not others — worse than one honest rule.
- Making production's photos work. That is a deployment, not code.

## Acceptance criteria

1. Adding a photo causes a sync run without anybody pressing anything.
2. Forty photos added at once cause one run, not forty.
3. A run already in flight is never started twice; a request during a run
   causes exactly one follow-up run.
4. A configuration fault stops the timer, and Settings says so.
5. An ordinary failure does not stop the timer.
6. Interval `Off` stops the timer and nothing else.
7. Blocked states (signed out, offline, not configured) skip quietly and do
   not pause anything.
8. The setting persists and is read on the next launch.

## Verified

Eleven scheduler tests on fake timers, and two of them were confirmed to fail
against the mistakes they guard rather than being assumed to have teeth:

- Removing the configuration-fault pause failed the two pause tests.
- Removing the in-flight guard failed nothing until the test was strengthened
  to advance the clock *while the first run was still open* — the original
  assertion counted runs after the run finished, which the bug also satisfies.
  That is worth recording: a passing test that cannot fail is worse than none.

Then driven in a browser against the production build, using the developer
mode from spec 013 — which is exactly what it was built for:

| Check | Result |
|---|---|
| Picker present in Settings | yes, defaulting to 30 |
| Choices | Only when photos change / 5 / 15 / 30 / Every hour / Every 3 hours |
| Changed to 5 and reloaded | still 5 |
| A run happened with nothing pressed | `[sync] media run complete …` |
| Status line | "Last automatic run 3:17:41 PM (photos changed)." |
| Page errors | none |

The photo row only renders when signed in, and the headless browser is signed
out by definition, so two edits were made **in the working tree only** to see
it — force the row to render, and force `mediaSyncBlocker` to return
undefined. Both were reverted afterwards and the tree confirmed clean:
`media-sync.ts` has no diff against `uat` at all.

What could **not** be verified here, and needs checking on UAT signed in: a
real upload succeeding. This environment has no Dexie Cloud session, so the
run that fired was a real run that then failed to authenticate — which proves
the trigger and not the transfer.

## Requirements touched

- FR-A03 (media sync), NFR-13 (a run that cannot be read afterwards did not
  happen).
