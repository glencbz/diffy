#!/usr/bin/env bash
# SessionStart hook: this repo is jj-backed and the policy is to use jj
# workspaces, never git worktrees (see CLAUDE.md). The harness can still land a
# session in a git worktree via `--worktree`, EnterWorktree, or Agent
# isolation: "worktree". Detect that and tell the model to switch.
set -euo pipefail

dir=$(pwd)

# A git worktree has `.git` as a file (gitdir pointer); the main checkout has it
# as a directory. A jj workspace has a `.jj` entry.
case "$dir" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac
[ -f "$dir/.git" ] || exit 0
[ -e "$dir/.jj" ] && exit 0

read -r -d '' msg <<'EOF' || true
This session is running in a git worktree under .claude/worktrees/. This repo
is jj-backed and the policy (CLAUDE.md) is to use jj workspaces, not git
worktrees. Prefer working in the main checkout on a jj change plus a bookmark
at the PR boundary. If you need a separate working copy, create a jj workspace
(jj workspace add) and cd into it so edits land in that workspace, not the
default one. See the jj skill.
EOF

jq -cn --arg ctx "$msg" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
