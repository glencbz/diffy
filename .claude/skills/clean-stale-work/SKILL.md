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

Before `--apply`, call `ListAgents` as well. The script holds a workspace only
if a Claude process has its cwd inside it. A session that is paused, or that
moved to a different workspace, leaves no process to find.

## What it decides

A workspace, worktree or bookmark is dropped only if everything it holds
already exists on `origin` or in `main`, and no open PR builds on it. Held
workspaces serve the preview URLs that open PR bodies link to, so they stay up
too. Anything with changes that exist nowhere else is held and reported, never
removed. So is a directory neither jj nor git knows about.

Two checks are easy to get wrong by hand:

- **Stale working copies.** A workspace whose `@` was rewritten from elsewhere,
  usually by a restack from the main checkout, refuses to snapshot. Its files
  may hold edits jj never recorded. The script diffs them against the tree jj
  last checked out there. Never run `jj workspace update-stale` to "fix" one
  before looking.
- **Old pid files.** `/tmp/diffy-serve/<dir>/*.pid` outlives its server, and
  PIDs get reused. The script kills a process group only while its leader's
  cwd is still inside that workspace. Never `pkill` by pattern: every
  workspace runs the same `bun run src/server.ts`.

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
