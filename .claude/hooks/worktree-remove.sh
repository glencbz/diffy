#!/usr/bin/env bash
# WorktreeRemove hook: tear down the jj workspace created by worktree-create.sh.
# The harness passes {worktree_path, ...} on stdin and checks the directory is
# gone afterwards.
set -euo pipefail

input=$(cat)
path=$(printf '%s' "$input" | jq -r '.worktree_path')

case "$path" in
  */.claude/worktrees/*) ;;
  *)
    echo "worktree-remove: not a managed workspace path: '$path'" >&2
    exit 1
    ;;
esac

name=$(basename "$path")
root=${path%/.claude/worktrees/*}

# forget drops the workspace's working-copy commit from the repo; missing is fine.
jj --repository "$root" --ignore-working-copy workspace forget "$name" >&2 2>&1 || true
rm -rf "$path"
