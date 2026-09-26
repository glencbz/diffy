---
name: review-branch
description: >
  Use when asked about the review branch, the combined preview of all WIP
  branches, the server on port 4000 or 9000, or when it shows a conflict or
  falls behind. One `review` bookmark merges every local WIP bookmark on top
  of main and is served at fixed ports by a watcher that rebuilds it whenever
  a bookmark or main moves. Covers starting and stopping the watcher,
  resolving a conflict in the chain, and why the chain has one merge per
  branch.
---

# The review branch

Each PR is served on its own ports by `just serve`. The review branch is the
one place to see all of them together: every local bookmark with work that is
not on `trunk()`, merged on top of it, running at

- app `https://<vm>.exe.xyz:4000/`
- docs `https://<vm>.exe.xyz:9000/`

The ports never move. `review.sh` pins them by writing `just serve`'s ports
file before calling it. The branch lives in the jj workspace
`.claude/worktrees/review`, and a watcher keeps it current.

```sh
.claude/skills/review-branch/review.sh start    # no-op if it already runs
.claude/skills/review-branch/review.sh status   # URLs, chain, conflicts
.claude/skills/review-branch/review.sh sync     # rebuild now, in the foreground
.claude/skills/review-branch/review.sh stop
.claude/skills/review-branch/test.sh            # fixture test, serves nothing
```

A `SessionStart` hook runs `start` for every session, so after a reboot the
watcher comes back with the first session. `start` also restarts a watcher that
runs an older copy of the script. Its log is `/tmp/diffy-review/watch.log`.

## How it is built

The branch is a chain of merge commits on `trunk()`, one per WIP bookmark,
described `review: merge <bookmark>`:

```
review ─ merge c ─ merge b ─ merge a ─ trunk()
            │         │         └── a
            │         └── b
            └── c
```

Each merge holds only the resolution of its bookmark against everything
below it. When a bookmark or `trunk()` moves, the watcher waits for it to hold
still, then puts each merge back onto its right parents with `jj rebase -s`.
jj carries a merge's resolution along as a diff against its parents, so a
conflict resolved once stays resolved until the code around it changes again.
When a session amends a WIP change, jj rebases the merges above it in the
same operation, and the watcher only has to refresh the server.

A merge keeps its place in the chain. New bookmarks go on top, oldest tip
first. A bookmark that lands on main or is forgotten has its merge abandoned,
and the merge above it is rebased onto the one below.

## Conflicts

`status` lists every merge as `clean`, `conflict` or `blocked`. A tree with
conflict markers does not build, so the server shows the chain up to the
first `conflict` and nothing above it. Resolve bottom-up, one merge at a time,
in a scratch workspace. Never resolve in `.claude/worktrees/review` itself: the
watcher moves its working copy.

```sh
jj workspace add --name review-resolve -r <merge change id> .claude/worktrees/review-resolve
cd .claude/worktrees/review-resolve && bun install
```

`src/` is tangled from `docs/`, so resolve the `docs/**` side and regenerate
the code rather than resolving both:

```sh
rm -f .entangled/filedb.json && uv run entangled tangle --force
grep -rlE '^<<<<<<< conflict' docs src .claude    # expect nothing
bunx tsc --noEmit && bunx biome check . && just test
jj squash                                        # into the merge
```

Typecheck every merge, not only the ones jj marks. Two branches can merge
cleanly and still not build together. A common case is a test fixture written
before a field that another branch made required. Fix it in the first merge
where both branches meet, since that is where the fix gets reused. `jjOpLog >
lists operations newest first` and the 5-second `pullDiffResponse` timeout
fail under load on main too.

Once one merge is squashed, jj rebases the ones above it, and some of their
conflicts go away. Run `jj log -r 'conflicts()'` again before starting the next
merge. When you are done, `jj workspace forget review-resolve`, remove the
directory, and run `review.sh sync` or let the watcher pick it up.

## Rules

- Never push `review` or open a PR from it. It is local and rebuilt freely.
- Never rebase or abandon the merges by hand. Move the bookmark they follow
  and let the watcher react. To take a branch out of the chain, land it or
  `jj bookmark forget` it.
- The merges are descendants of every WIP change, so `jj log` shows them and
  `jj rebase -s <root> -o 'trunk()'` on a WIP branch drags them along. That is
  expected and harmless.
- If a sync reports a divergent merge, two operations rewrote it at once.
  Look at both copies with `jj log -r 'divergent()'`, `jj abandon` the one
  without the resolution, and sync.

## Why one merge per branch

A single octopus merge of all branches would put every resolution in one
commit. When any branch moved, the resolution would be reapplied against the
whole new set at once. One unrelated conflict would take every other
resolution down with it. Rebuilding from scratch on every change is simpler
still, but it throws resolutions away and brings back git's `rerere`, which jj
does not have. A chain limits the damage to the merges above the one that
moved, and each resolution sits in a commit named for the branch it belongs
to.
