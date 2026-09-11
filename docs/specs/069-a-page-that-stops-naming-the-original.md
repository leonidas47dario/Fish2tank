# 069 — A page that stops naming the original

## What was asked

> bug20 + a tank worth showing (the social feature) is what we should focus on
> next

BUG-20, filed when spec 064 shipped:

> **Photographs published before spec 064 are still in R2 with their EXIF.**
> Spec 064 stops the bleeding — no photograph leaves the device carrying
> metadata from now on — but it cannot clean what is already there.

## The problem, and where the filed row got it wrong

Before spec 064, `publishTank` published `viewableBlobKey` — the preview where
one existed, and **the original otherwise**. `planRendition` never upscales, so
a photograph already under `PREVIEW_EDGE` has no preview and never will. Those
tanks published the keeper's file byte for byte, EXIF and GPS included. A
keeper's tank is in their home, so that tag is their home address.

BUG-20's own assessment was that fixing this needs a bucket sweep:

> Republishing uploads a clean derivative but does not remove the old one: the
> Worker has no delete route on purpose … Likely shape is the same server-side
> reconciliation ENH-11 needs, which is why the two should be fixed together.

**That is the wrong shape, and the reason is worth stating plainly.**

The EXIF-bearing object in R2 is `users/<sub>/<originalBlobKey>` — the
keeper's **own backup of their own photograph**, which NFR-03 says is kept
exactly as they left it. Deleting it would not be a privacy fix; it would be
deleting their photo. It is not supposed to leave.

What made it a leak is not that it exists. It is that a share manifest **named
it**. Public reachability is decided entirely by one function:

```ts
function permits(manifest: ShareManifest, blobKey: string): boolean {
  const keys = manifest.allowedBlobKeys;
  return Array.isArray(keys) && keys.includes(blobKey);
}
```

A key no live manifest names cannot be fetched by anybody holding the link.
Republishing reuses the token and **replaces** the manifest, so the moment a
stale share is republished, the original stops being served — without deleting
anything, without a delete route, and without waiting for ENH-11.

So this is not a bucket problem. It is one stale row per affected tank.

## The fix

`ShareRecord` gains `strippedMetadata?: boolean`, set by `publishTank` from now
on. `needsRepublish` returns true when it is absent. Every stale share then
republishes exactly once, through the machinery that already exists — the same
`useAutoRepublish` pass that handles a renamed tank, on the app's next open.

Optional on the type because rows written before this exist, and **absent is
the whole signal**: it is precisely the set of shares published by code that
did not strip.

## In scope

- The flag, set on publish.
- `needsRepublish` reading it.
- The republish itself, via the existing automatic pass.

## Out of scope

**Deleting the original from R2.** It is the keeper's backup, it is covered by
NFR-03, and after this it is not publicly reachable. ENH-11's reconciliation is
still worth building for orphaned blobs; it is no longer a prerequisite for
this.

**Telling the keeper.** Considered and rejected: the remedy is automatic and
complete, and a notice whose only available action is "we already did it"
teaches a keeper to fear a screen they cannot act on. The BACKLOG row carries
the disclosure.

## What this cannot fix, stated rather than implied

**Anyone who already fetched the file has it.** A share link is public to
whoever holds it; a stranger who downloaded a photograph before this keeps the
copy they took, EXIF and all. This closes the exposure from now on. It does not
and cannot retract what was served.

## Acceptance criteria

1. A share published after this carries `strippedMetadata: true`.
2. A share record without the flag is republished by `needsRepublish`, even
   when nothing about the tank has changed.
3. Once republished, it is not republished again — no loop.
4. The republished manifest names the stripped preview and **not** the
   original, for the tank photo and for each resident.
5. The original blob is untouched in local storage and in R2 (NFR-03).

## Alternatives rejected

**Compare `publishedAt` against a hardcoded 064 deploy date.** A date the code
carries is a fact about a deployment, not about a row, and it is wrong for any
device that was offline across the boundary or whose clock disagreed. The flag
describes what the row actually is.

**Republish everything unconditionally, once.** Simpler to write and impossible
to reason about afterwards: nothing on the record would say whether it had
happened, so the next person to ask "is this page clean?" has no way to answer
except by reading the manifest.

**A `publishVersion: number` instead of a boolean.** Would generalise to the
next rule change, and there is no next rule change to design against. A boolean
that says the one thing that is true is easier to delete when it stops
mattering.

## Requirements touched

- **NFR-04** — strip EXIF from shared derivatives. This is the retrospective
  half; spec 064 was the prospective one.
- **NFR-03** — the original is never modified. Upheld by not touching it.
- **FR-S03** — the automatic republisher. Extended by one condition.
