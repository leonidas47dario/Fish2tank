---
name: deploy-to-main
description: Promote the uat branch to main (production) in this repo. Use this whenever the user says to ship, promote, deploy to prod/production, push to main, release, or "good to go to main" after signing off on a UAT build. Also use it before attempting any uat-to-main merge by hand, because the obvious routes all fail here - main enforces linear history, so direct pushes and merge commits are rejected, `git merge -s ours` is blocked by the permission classifier, and a PR straight from uat always reports itself unmergeable even when nothing is actually in conflict.
---

# Promoting uat to main

`main` in `leonidas47dario/Fish2tank` is protected by the "main protection"
ruleset (id `21783978`) with `required_linear_history` and `pull_request`.

Because **every promotion squashes**, `main` ends up holding one commit whose
*tree* equals `uat` but whose *history* shares nothing with uat's commits. Git
therefore reports a permanent false divergence, and the naive routes fail:

| Route | Result |
|---|---|
| `git push origin uat:main` | rejected by the ruleset |
| `gh pr merge --merge` | rejected — `required_linear_history`, not the repo's `allow_merge_commit` setting |
| PR with `head=uat` | `mergeable: false, state: dirty`, hundreds of phantom conflicts that all resolve to uat's side |
| `git merge -s ours origin/main` | blocked by the permission classifier (it discards the other side, which reads as destructive) |

What works is to put uat's **tree** on top of main's **history** as a single
commit, then squash-merge that. The steps below do exactly that, with the
checks that make it safe.

## Before you start

Work from a worktree if other sessions are active (see the project memory on
worktree isolation). Run every git command as a plain, separate invocation —
compound commands with `&&`, `for` loops or `GIT_CONFIG_*` get refused in a
worktree-isolated session.

If `gh` fails with `unable to access '/etc/gitconfig'`, use `gh api` directly
rather than `gh pr` / `gh run` subcommands; the API path does not shell out to
git.

## Step 1 — Prove main holds nothing uat lacks

This is the check that makes the whole thing safe. Find the uat ancestor whose
tree matches `main`: if one exists, main is a squashed ancestor of uat and the
promotion loses nothing.

```bash
git fetch origin
git log --format=%h -20 origin/uat > /tmp/refs.txt
```

Then a small script (a `for` loop inline will be refused):

```bash
#!/usr/bin/env bash
set -u
while read -r ref; do
  if [ -z "$(git diff --stat origin/main "$ref" --)" ]; then
    echo "TREE MATCH  $ref  $(git log -1 --format=%s "$ref")"
  fi
done < /tmp/refs.txt
```

**No tree match means stop.** Main holds something uat does not, and blindly
applying uat's tree would delete it. Work out what it is first.

## Step 2 — Check for deletions

The `git checkout origin/uat -- .` in the next step copies files *in*; it does
not remove files that uat deleted. Confirm there are none:

```bash
git diff --diff-filter=D --name-only origin/main origin/uat
```

If that lists anything, `git rm` those paths after step 3 — otherwise they will
survive into main and the trees will not match.

## Step 3 — Build the promote branch

```bash
git checkout -B promote origin/main
git checkout origin/uat -- .
git diff --stat origin/uat --
```

**That last diff must be empty.** It is the proof that the promote branch's
tree is byte-identical to uat. Do not continue on a non-empty diff.

Commit with a message that says what shipped and what is knowingly deferred —
this squash commit is the only history main will keep, so it is the record.

## Step 4 — PR and squash-merge

```bash
git push -u origin promote
```

A `cannot lock ref` error mentioning an existing `refs/remotes/origin/promote/*`
is only a local tracking-ref collision; the push itself succeeded. Confirm with
`gh api repos/leonidas47dario/Fish2tank/branches/promote`, then
`git remote prune origin` to clear it.

Open the PR with `head=promote`, `base=main`. Wait for `mergeable: true` and
`state: clean` — `unstable` means checks are still running:

```bash
gh api repos/leonidas47dario/Fish2tank/pulls/<N> \
  --jq '"mergeable: \(.mergeable)  state: \(.mergeable_state)"'
```

Merge with **squash**, never merge:

```bash
gh api -X PUT repos/leonidas47dario/Fish2tank/pulls/<N>/merge \
  -f merge_method=squash -f commit_title="..."
```

A PR's head branch cannot be changed after creation. If you opened one from
`uat` by mistake, close it and open a new one rather than trying to PATCH it.

## Step 5 — Verify, then clean up

```bash
git fetch origin
git diff --stat origin/main origin/uat --
```

Empty means the promotion is complete. Then delete the promote branch and the
feature branch:

```bash
gh api -X DELETE repos/leonidas47dario/Fish2tank/git/refs/heads/promote
```

Finally confirm the production deploy, since a green PR is not a green site:

```bash
gh api repos/leonidas47dario/Fish2tank/actions/runs \
  --jq '.workflow_runs[] | select(.head_branch=="main") | "\(.status) \(.conclusion // "-") \(.head_sha[0:7]) \(.name)"'
```

A push to either branch rebuilds **both** environments, and both builds run the
tests. Production is <https://leonidas47dario.github.io/Fish2tank/>.

## What not to do

- Do not promote anything that has not been live on `/uat/` and signed off.
  That rule is the point of the two-branch topology, not a formality.
- Do not skip the empty-diff checks in steps 1, 3 and 5. They are the only
  thing standing between "applied uat's tree" and "silently reverted a commit
  that only existed on main".
- Do not squash-merge while `mergeable_state` is `unstable`. Wait for `clean`.
