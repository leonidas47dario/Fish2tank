# 060 — A missing branch and a broken connection are not the same answer

**Status:** implemented.
**Date:** 2026-09-04.
**Touches:** FR-R14.
**Closes:** BUG-19.
**Related:** spec 059, which found this and correctly refused to fix it as part
of a hosting migration it does not belong to.

---

## What was asked

Found while contrasting hosting options for spec 059, and confirmed as its own
change rather than part of that migration:

> Fix now, own PR

## The defect

`.github/workflows/deploy.yml` asked whether a `uat` branch exists:

```bash
if git ls-remote --exit-code --heads \
    "https://github.com/${{ github.repository }}.git" uat >/dev/null 2>&1; then
  echo "exists=true"  >> "$GITHUB_OUTPUT"
else
  echo "exists=false" >> "$GITHUB_OUTPUT"
fi
```

**A wrong "no" here does not skip staging — it deletes it.** GitHub Pages serves
one site per repository, so this workflow assembles production and staging into
a single artifact and publishes it whole. `exists=false` omits `site/uat`, and
publishing the artifact then removes the live `/uat/` site. The workflow's own
header says so: *"publishing only half of it would delete the other
environment."*

That makes every answer this step cannot be sure of dangerous, and `else`
swallowed two classes of them.

### The call was anonymous

An unauthenticated `ls-remote` against a **private** repository fails. It cannot
report "this branch is not here" versus "I am not allowed to look", and the code
read the failure as the former. The repository is public today, so this is
latent — but it fires on the first deploy after any decision to make it private,
which is exactly the decision spec 059 was written to evaluate. Silently, with
`/uat/` gone and a green check.

### And every other failure took the same path

A network blip, a rate limit, or a GitHub outage produced the same
`exists=false`. **A transient error deleted staging** — permanently, since the
next deploy would have to rebuild it. This half is live today and has nothing to
do with repository visibility.

## The fix

Authenticate the call, and stop treating "something went wrong" as "no".

`git ls-remote --exit-code` distinguishes these, and the exit codes were
**measured rather than taken from the manual**:

| Case | Exit |
|---|---|
| `uat` exists | 0 |
| branch genuinely absent | 2 |
| repository unreachable or 404 | 128 |
| network failure | 128 |

Measured 2026-09-04 against this repository and a deliberately broken proxy.
The row that matters is the third: **a private repository's 404 is 128, not 2**,
so it was never distinguishable from success-with-no-branch by an `if`, and it
is trivially distinguishable by exit code.

So the step now branches three ways. `0` includes staging, `2` — git's own
documented "no matching refs" — is the only accepted no, and anything else fails
the job with an error that says why. Publishing half the site is worse than not
publishing.

## Acceptance criteria

1. The step authenticates with `github.token`, so it answers correctly on a
   private repository.
2. Exit `2` still sets `exists=false` and still emits the existing notice, so a
   fork with no `uat` branch deploys production alone exactly as before.
3. Any other non-zero exit fails the job rather than setting `exists=false`.
4. The YAML parses and the error heredoc terminates at column 0 after the block
   scalar is dedented.
5. No behaviour change on a public repository with a `uat` branch present —
   which is every deploy this repo does today.

## Alternatives rejected

**Add the token and stop there.** This is what was asked for, and it fixes only
the half that is not yet live. The transient-failure path deletes staging today,
costs three lines to close, and is the same defect wearing a different hat.

**Reuse the authenticated `prod` checkout** (`git -C prod ls-remote origin uat`).
Works, because `actions/checkout` persists credentials — and that is the problem:
it makes this step silently depend on `persist-credentials` staying default in a
step forty lines away. An explicit token is longer and cannot be broken from a
distance.

**Fail the job whenever `uat` is missing.** Rejected. `enablement: true` in this
workflow exists so a fork deploys without manual setup, and a fork with no `uat`
branch is a legitimate state, not an error.
