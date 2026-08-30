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

## Step 2 — Check for deletions, with `--no-renames`

The `git checkout origin/uat -- .` in the next step copies files *in*; it does
not remove files that uat deleted. Find them:

```bash
git diff --no-renames --diff-filter=D --name-only origin/main origin/uat
```

**`--no-renames` is load-bearing.** Without it, git classifies a move as a
rename rather than a delete plus an add, and the old path never appears. On
2026-08-29 the plain form reported **1** file while the true answer was **11**:
a UI branch had moved ten `design/*` files into `design/prototype/`, and all ten
would have survived into main as duplicates, failing the step-5 tree check at
the very end of the promotion.

If that lists anything, remove those paths after step 3 — otherwise they will
survive into main and the trees will not match.

## Step 3 — Build the promote commit

**Prefer `commit-tree`.** It puts uat's tree on main's history in one object,
which is the whole goal, and it gets the tree right *by construction* rather
than by remembering to delete the files from step 2. It also does not touch the
working tree, so nothing can be half-applied. Write the message to a file
first, then:

```bash
git commit-tree "$(git rev-parse origin/uat^{tree})" -p origin/main -F /tmp/promote-msg.txt
```

Verify the object before pushing it — both must hold:

```bash
git rev-parse <sha>^{tree}   # == git rev-parse origin/uat^{tree}
git rev-parse <sha>^1        # == git rev-parse origin/main
```

Push it by SHA. `git branch -f promote <sha>` fails with "Cannot force update
the current branch" if the worktree is already on `promote`:

```bash
git push -f origin <sha>:refs/heads/promote
```

The message is the record: this squash commit is the only history main keeps,
so it should say what shipped and what is knowingly deferred.

<details><summary>The older checkout route, and why it is worse</summary>

```bash
git checkout -B promote origin/main
git checkout origin/uat -- .
# then remove every path from step 2
git diff --stat origin/uat --      # must be empty
```

Two problems. It depends on step 2 having found every deletion, and the
permission classifier refuses `git rm`, `git read-tree` and
`git update-index --force-remove` as destructive — sometimes after allowing
the same command on an earlier path in the same session. Expect to be blocked
part-way through with the tree in an inconsistent state.
</details>

### If `promote` still exists on the remote

Deleting the branch in step 5 fails in some sessions (see the note there), so
the next promotion finds a `promote` ref pointing at the *last* promotion and
the push in step 4 is rejected as non-fast-forward.

**Do not reach for ancestry to decide whether it is safe to replace.**
`git merge-base --is-ancestor origin/promote origin/main` reports NO even when
the branch is a spent leftover, because the promotion squashed - which is the
same false divergence this whole document exists to work around. Compare
**trees**, exactly as in step 1:

```bash
git diff --stat origin/main origin/promote --
```

Empty means its tree is already on `main`: it is last promotion's leftover and
carries nothing. Replace it with a lease pinned to the commit you just
verified, so the push fails rather than clobbers if it is not what you verified:

```bash
git push --force-with-lease=refs/heads/promote:<that sha> -u origin promote
```

A **non-empty** diff means someone built a promote branch that never merged.
Stop and find out what it is before touching it.

## Step 4 — PR and squash-merge

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

`gh` cannot read `/tmp` even though the shell can, so `--body-file /tmp/x` and
`gh api -F body=@/tmp/x` both fail with "no such file or directory". Redirect
instead: `gh pr create ... --body-file - < /tmp/promote-msg.txt`.

Merge with **squash**, never merge:

```bash
gh api -X PUT repos/leonidas47dario/Fish2tank/pulls/<N>/merge \
  -f merge_method=squash -f commit_title="..."
```

**Expect this to be refused.** The classifier blocks both `gh api ... /merge`
and `gh pr merge --squash`. Hand Ryan the PR URL and ask him to click Squash
and merge; he has done this before and is fine with it. Do not burn turns
retrying variants.

A PR's head branch cannot be changed after creation. If you opened one from
`uat` by mistake, close it and open a new one rather than trying to PATCH it.

## Step 5 — Verify, then clean up

```bash
git fetch origin
git diff --stat origin/main origin/uat --
```

Empty means the promotion is complete.

If it is **not** empty, check the direction before worrying. uat moves during a
promotion, so pure additions from a commit dated after your snapshot are
expected, not a failure. What matters is that main lost nothing:

```bash
git rev-parse origin/main^{tree}   # == the tree of the uat commit you promoted
git diff --diff-filter=DM --name-only origin/main origin/uat --   # must be empty
```

Then delete the promote branch and the feature branch:

```bash
gh api -X DELETE repos/leonidas47dario/Fish2tank/git/refs/heads/promote
```

**This deletion is best-effort, and has failed twice.** A `git push` of a ref
deletion through the agent proxy dies with `send-pack: unexpected disconnect
while reading sideband packet`, and retrying does not help. It leaves nothing
wrong with the promotion - `main` is already correct - but the surviving branch
blocks the *next* promotion's push, so if it will not go, say so rather than
recording it as cosmetic, and handle it per step 3 next time.

Finally confirm the production deploy, since a green PR is not a green site:

```bash
gh api repos/leonidas47dario/Fish2tank/actions/runs \
  --jq '.workflow_runs[] | select(.name=="Deploy") | "\(.status) \(.conclusion // "-") \(.head_branch) \(.head_sha[0:7])"'
```

Filter on `name=="Deploy"`, not on `head_branch=="main"`. **The main Deploy is
routinely `cancelled`** and that is usually fine: `concurrency: group: pages,
cancel-in-progress: true` means a uat push seconds later supersedes it, and
because the workflow checks out *both* branches and builds both environments,
the uat run publishes main correctly anyway. On 2026-08-29 the main deploy was
cancelled 16s after the promotion and production was still correct.

So do not trust the run status alone. Fetch the site and look for a marker only
the new build has:

```bash
curl -s https://leonidas47dario.github.io/Fish2tank/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.css'
curl -s https://leonidas47dario.github.io/Fish2tank/assets/index-<hash>.css | grep -c -- '--plate-l'
```

The bundle hash will differ from a local build: the deploy sets a different
base path per environment, which changes the content. That is expected.

Production is <https://leonidas47dario.github.io/Fish2tank/>.

## What not to do

- Do not promote anything that has not been live on `/uat/` and signed off.
  That rule is the point of the two-branch topology, not a formality.
- Do not skip the empty-diff checks in steps 1, 3 and 5. They are the only
  thing standing between "applied uat's tree" and "silently reverted a commit
  that only existed on main".
- Do not squash-merge while `mergeable_state` is `unstable`. Wait for `clean`.
