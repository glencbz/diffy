---
name: update-branches
description: >
  Use for /update-branches, or when asked to bring every branch up to date
  with main, restack all WIP onto the new main, catch up after PRs landed, or
  clean up dead branches and workspaces. Fetches origin, sweeps landed and
  dead bookmarks, workspaces and preview servers, rebases every remaining WIP
  bookmark onto the new trunk() in one rebase, and rebuilds the review chain.
  Local only: it pushes nothing.
---

# Updating every branch

When PRs land, every other branch is left on an old main and the review chain
from the `review-branch` skill is left on it too. `update.sh` catches them
all up in one pass:

1. Fetches `origin`. `main` moves with it.
2. Runs the `clean-stale-work` sweep, which drops landed and dead bookmarks,
   workspaces and preview servers, and holds anything that exists nowhere
   else.
3. Rebases every local bookmark with work not on `trunk()` onto it. The set is
   the same one the review chain merges.
4. Runs `review.sh sync`, then lists the WIP changes and review merges that
   still need a hand.

```sh
.claude/skills/update-branches/update.sh           # fetch, then dry run
.claude/skills/update-branches/update.sh --apply   # do it
.claude/skills/update-branches/test.sh             # fixture test, touches nothing
```

Read the dry run first. It prints the sweep's plan and every branch root that
would move. Before `--apply`, call `ListAgents` too, for the reason the
`clean-stale-work` skill gives: a paused session leaves no process for the
sweep to find. Rerunning is safe. Once everything is current, a run fetches
and reports, and changes nothing.

The output carries a restore point. `jj op restore <id>` undoes the whole run,
along with anything other sessions did since.

## What is left to do

The last section of the output lists what the run could not finish.

- **`conflict`**: a WIP change that conflicts with the new main. Resolve it in
  that change, in a scratch workspace, as in the `jj-commit-stack` skill.
  Never resolve it at the tip of the stack. The changes above it and its
  review merge are rebased along with it.
- **`emptied`**: a change with nothing left once rebased, usually because its
  PR was squash-merged. Check that its work really is on main, then
  `jj abandon` it. If that empties its bookmark too, the next run's sweep
  forgets the bookmark.
- **Review chain**: the `review.sh status` table. Resolve any `conflict`
  merge bottom-up, as the `review-branch` skill says. Fix the WIP conflicts
  first, because a conflicted branch makes its merge conflict as well.

Other sessions whose `@` sat on a rebased branch now have a stale working copy,
and their next jj command says so. That is theirs to settle. Never run
`jj workspace update-stale` in someone else's workspace.

## Pushing

The run is local. Each rebased branch with an open PR now differs from its
remote. Push one only when the user asks, through the `submit-for-review`
skill, so the PR gets fresh preview servers too.

## Why one rebase

Every root goes in a single `jj rebase -s` onto `trunk()`. Rebasing branch by
branch would rewrite a stacked branch once for its base and again for itself.
It would also rewrite each review merge once per branch below it, and each
pass risks a conflict in a commit the next pass then moves again. With one
rebase, jj rewrites every descendant exactly once and carries each merge's
resolution along.

The rebase does not pass `--skip-emptied`, although that would abandon
squash-merged changes for free. It would also abandon any review merge whose
resolution the new main made unnecessary, and the merges above it would then
sit on the wrong parents. So emptied changes are reported and you abandon them
by hand.

The sweep runs before the rebase, so a landed or dead branch is forgotten
rather than rebased into conflicts nobody will resolve.
