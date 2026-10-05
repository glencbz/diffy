---
name: update-branches
description: >
  Use for /update-branches, or when asked to bring every branch up to date
  with main, restack all WIP onto the new main, catch up after PRs landed, or
  clean up dead branches and workspaces. Fetches origin, sweeps landed and
  dead bookmarks, workspaces and preview servers, rebases every remaining WIP
  bookmark onto the new trunk() in one rebase, rebuilds the review chain,
  resolves what conflicts, pushes every open PR's branch, and restarts the
  previews the rebase left behind.
---

# Updating every branch

When PRs land, every other branch is left on an old main and the review chain
from the `review-branch` skill is left on it too. `update.sh` catches them
all up in one pass:

1. Fetches `origin`. `main` moves with it.
2. Runs the `clean-stale-work` sweep, which drops landed and dead bookmarks,
   every workspace nothing uses, and previews nobody links to. It holds
   anything that exists nowhere else.
3. Rebases every local bookmark with work not on `trunk()` onto it. The set is
   the same one the review chain merges.
4. Runs `review.sh sync`.
5. Pushes the branch of every open PR that moved and has no conflict, and
   holds back any branch that has one.
6. Restarts every preview the sweep kept whose workspace the rebase moved,
   on the same ports, so the URLs in PR bodies serve the new code.
7. Lists the WIP changes and review merges that still need a hand.

```sh
.claude/skills/update-branches/update.sh    # do it
.claude/skills/update-branches/test.sh      # fixture test, touches nothing
```

Run it straight away. There is no dry run, and no need to check first with
other sessions: the sweep never removes work that exists nowhere else, and
every preview it stops for a rebase it starts again. Rerunning is safe. Once
everything is current and pushed, a run fetches and reports, and changes
nothing.

Run `trunk()`'s copy of the script, never one in a workspace the sweep may
drop: bash reads a script as it runs, and the sweep deletes that directory
partway through. `jj file show -r 'trunk()'` the three skills' scripts into
a scratch directory when no checkout of main is at hand.

The output carries a restore point. `jj op restore <id>` undoes the whole run,
along with anything other sessions did since.

## What is left to do

The last section of the output lists what the run could not finish. The run
is not done until it is empty and the review chain is clean, so work through
it, then run `--apply` again to push what it held back.

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
  first, because a conflicted branch makes its merge conflict as well. Once
  they are fixed, a merge often still conflicts, because its stored
  resolution was written against the old code. A merge whose only parents
  are `trunk()` and its branch, with the branch already on `trunk()`, has
  nothing to resolve: `jj restore --from <branch tip>` in it and squash.

A branch that sat on a main many PRs old is a port, not a merge. Resolve the
`docs/**` side and tangle, as the `review-branch` skill says. A file the
branch deletes stays on disk with conflict markers after the tangle, because
nothing writes it any more; delete it by hand. Then typecheck: a block the
branch adds still names whatever main has since moved or renamed, and only
`tsc` finds those.

Other sessions whose `@` sat on a rebased branch now have a stale working copy,
and their next jj command says so. That is theirs to settle. The run settles
it only in a workspace that serves a preview and that no live session is in,
after checking that its files hold nothing jj has not seen. Never run
`jj workspace update-stale` in a workspace by hand.

## Pushing

Each rebased branch with an open PR differs from its remote, and the run
pushes it once it has no conflict. It then restarts each preview whose code
moved, so the PR body's `## Preview` URLs keep working. The `### previews`
section lists any it could not restart: one a live session owns, which that
session refreshes, and one whose files hold edits jj never saw.

The run pushes only bookmarks that already head an open PR. A new branch
still goes up through `submit-for-review`, which opens its PR.

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
