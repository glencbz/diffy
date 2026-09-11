#!/usr/bin/env bash
# SessionStart hook: this repo is jj-backed and the policy is to use jj
# workspaces, never git worktrees (see CLAUDE.md). The harness can still land a
# session in a git worktree via a background or bridge session, `--worktree`,
# EnterWorktree, or Agent isolation: "worktree". Detect that and tell the model
# to provision its own jj workspace and move into it.
set -euo pipefail

dir=$(pwd)

# A git worktree has `.git` as a file (gitdir pointer); the main checkout has it
# as a directory. A jj workspace has a `.jj` entry and is already fine.
case "$dir" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac
[ -f "$dir/.git" ] || exit 0
[ -e "$dir/.jj" ] && exit 0

name=$(basename "$dir")
root=${dir%/.claude/worktrees/*}
ws_dir="$root/.claude/worktrees/${name}-ws"

read -r -d '' msg <<EOF || true
This session is running in a git worktree under .claude/worktrees/. This repo
is jj-backed: jj walks up to the main repo's .jj and never snapshots edits made
in this directory, so anything changed here is silently lost. The policy
(CLAUDE.md) is jj workspaces, never git worktrees.

The workaround is to provision your own jj workspace and move into it before
editing anything, not to fall back to the main checkout:

  jj --repository "$root" workspace add --name "${name}-ws" "$ws_dir"
  cd "$ws_dir"

Work there and add a Git bookmark only at the PR boundary. When the task is
done, release the workspace with:

  jj --repository "$root" --ignore-working-copy workspace forget "${name}-ws"
  rm -rf "$ws_dir"

Do not work in the main checkout at $root instead: other sessions share its
default workspace and your edits would collide with theirs.
EOF

jq -cn --arg ctx "$msg" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
