# 068 — A store it cannot read is not an empty store

## What was asked

A share link, pasted with no commentary:

> https://fish2tank-media-uat.leonidas47dario.workers.dev/p/b40fb456-…

It answers `{"error":"no such share"}`. That is meant to say *this share was
revoked*. It cannot be trusted to say that, and finding out why is this spec.

## The problem

```ts
const res = await aws.fetch(endpointFor(manifestKeyFor(token)), { method: 'GET' });
if (res.status === 404 || res.status === 403) return undefined;   // ← both
```

`undefined` is what revoked looks like. It was also what **a Worker that cannot
reach its own bucket** looks like — a wrong access key, a rotated secret, a
bucket renamed out from under it. In that state *every* token in the tier
answers `no such share`: a revoked link, a live link, and a totally unserving
tier are one indistinguishable 404, and nothing in the system disagrees.

**Including the deploy probe.** `deploy-worker.yml`'s last step reads
`/shared/probeprobe`, sees `no such share`, and prints *"Share routes (spec
023) are live."* So a tier that could serve nothing at all would pass the check
whose entire stated purpose is to distinguish *deployed* from *believed
deployed* — the failure that cost production a month of broken photo sync and
that the workflow's own header comment is about.

This is the shape of defect this project keeps paying for, stated in
`client.test.ts` already: *"Every defect this project has shipped in the sync
area was a green status over nothing."* This one is a green status over a tier
that might be entirely dark.

## The 403 arm was not careless

S3 answers 403 rather than 404 for a missing object when the credential cannot
list the bucket, so a 403 genuinely can mean absent. The mistake was using the
**status** to decide, when the status is the one thing that cannot tell the two
apart. The error **code** in the body can: `NoSuchKey` means absent;
`InvalidAccessKeyId`, `SignatureDoesNotMatch` and `AccessDenied` do not.

## In scope

- `readManifest` returns `undefined` for a 404, and for a 403 **only** when the
  body's `<Code>` is `NoSuchKey`. Every other 403 throws, and the route's
  existing catch turns it into a 500 naming the code.
- The deploy probe fails the run on that answer, with the remedy in the log.

## Out of scope

**Whether the uat tier is currently in this state.** This spec makes the
question answerable; it does not assume an answer. The very next deploy says.

**Retrying or falling back on a refused read.** A credential that does not work
does not work. Reporting it is the whole job here.

## Acceptance criteria

1. A 403 carrying `InvalidAccessKeyId` or `SignatureDoesNotMatch` does not
   produce a 404 and does not produce the string `no such share`, on
   `/shared/:token` or `/p/:token`.
2. A 403 carrying `NoSuchKey` still reads as a revoked share — the S3
   behaviour the original arm existed for.
3. A body that cannot be parsed for a code is treated as a fault, not as
   absent. The regex is chosen over a parser so the error path cannot throw.
4. The deploy probe fails, rather than reporting the tier live, when the
   Worker says it cannot read the store.
5. Both new tests fail against the pre-fix code. Verified.

## Alternatives rejected

**Treat every 403 as a fault.** Simpler, and it would break the real
`NoSuchKey`-as-403 case into a 500 — turning an ordinary revoked link into an
error page. The code check costs three lines and keeps both answers true.

**A health route that checks R2 on demand.** A new public surface on a Worker
whose public routes are a deliberately closed enumerated set (spec 023), to
answer a question the existing routes should not have been lying about in the
first place.

## Requirements touched

- **NFR-13** — an error that reports itself as an ordinary negative answer is
  not diagnostics.
- **FR-S07 / spec 023** — the public surface stays the same three routes.
