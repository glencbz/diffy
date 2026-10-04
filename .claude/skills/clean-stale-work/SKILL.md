---
name: clean-stale-work
description: >
  Use when asked to clean up, prune, sweep, or scrub stale jj workspaces, git
  worktrees, bookmarks, branches, or leftover preview servers in this repo, or
  when .claude/worktrees or /tmp/diffy-serve has piled up. Local only: reads
  GitHub for the open PR list and never writes to it. Runs a dry-run-first
  sweep script that holds anything live, unpublished, or tied to an open PR.
---

# Cleaning up stale work

Every session here gets its own jj workspace under `.claude/worktrees/`, and
every PR round starts a preview server in it with `just serve`. None of that
goes away by itself. `sweep.sh` finds what nothing needs any more and removes
it without touching GitHub.

## Run it

```sh
.claude/skills/clean-stale-work/sweep.sh           # dry run: prints the plan
.claude/skills/clean-stale-work/sweep.sh --apply   # does it
```

Run it from any workspace; it finds the default one itself. Read the dry run
before applying. Every line is `drop`, `hold`, or `keep`, followed by the reason.
Rerunning is safe: a second `--apply` does nothing new.

A Claude process keeps its cwd in the checkout it started in, so a session
busy in a workspace of its own often leaves no process there to find. The
script also holds anything written to in the last five minutes
(`SWEEP_FRESH_MINUTES`). Without that, a workspace a session has just created
looks dead.

## What it decides

A workspace, worktree or bookmark is dropped once everything it holds
already exists on `origin` or in `main`. Sitting on an open PR's stack is not
enough to keep it. A workspace whose preview server is still wanted is kept:
an open PR body links its port, or it started in the last five minutes. After
the sweep, `--apply` restarts each kept preview whose workspace was rewritten
from elsewhere, on the same ports. Previews nothing links to are stopped with
their workspace. Anything with changes that exist nowhere else is held and
reported, never removed.

A directory under `.claude/worktrees/` that neither jj nor git knows about is
usually a forgotten workspace. Its non-ignored files go into a tarball under
`~/.cache/diffy-sweep/` before it is deleted.

Two checks are easy to get wrong by hand:

- **Stale working copies.** A workspace whose `@` was rewritten from elsewhere,
  usually by a restack from the main checkout, refuses to snapshot. Its files
  may hold edits jj never recorded. The script diffs them against the tree jj
  last checked out there, ignoring the `.jjconflict-*` directories jj leaves
  behind. Never run `jj workspace update-stale` to "fix" one
  before looking.
- **Old pid files.** `/tmp/diffy-serve/<dir>/*.pid` outlives its server, and
  PIDs get reused. The script kills a process group only while its leader's
  cwd is still inside that workspace. Never `pkill` by pattern: every
  workspace runs the same `bun run src/cli.ts`.

## Staying off GitHub

- Forget bookmarks with `jj bookmark forget`; never `jj bookmark delete`. A
  deleted bookmark that tracks `origin` is a pending deletion, and the next
  `jj git push --deleted` removes the branch from GitHub. The sweep
  forgets any such pending deletions it finds.
- Branches of merged or closed PRs stay on GitHub, so `jj git fetch` brings
  them back as `name@origin`. Deleting them there is the user's call, not this
  sweep's.
- Leave `main` where fetch puts it and never move it by hand. Other sessions
  share it.

## After the sweep

The last section lists commits that no bookmark, workspace or `main` reaches.
The sweep leaves them in place. Read each one before running `jj abandon`: a
PR closed without merging can leave work that exists nowhere else.

To undo, `jj op restore <restore point>` from the top of the output. It also
rolls back anything other sessions did since, so prefer restoring just the
piece you need, such as `jj workspace add` or `jj bookmark set`.

Leave `~/.claude/projects/` alone. The transcripts there are the only record
of what past sessions did.

## Reply

Report what was dropped, everything held with its reason, and the restore
point. If a `kill` was refused by the permission prompt, say which PIDs are
still running rather than working around it.
