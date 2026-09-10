#!/usr/bin/env bash
# WorktreeCreate hook: create a jj workspace instead of a git worktree.
#
# The harness uses this hook (see "Configure WorktreeCreate/WorktreeRemove
# hooks in settings.json to use worktree isolation with other VCS systems") to
# delegate isolated-worktree creation. It passes {name, cwd, ...} on stdin and
# expects the absolute path of the new working copy on stdout.
set -euo pipefail

input=$(cat)
name=$(printf '%s' "$input" | jq -r '.name')
cwd=$(printf '%s' "$input" | jq -r '.cwd // "."')

# Reject anything that isn't a plain slug so the path stays inside the repo.
case "$name" in
  ''|*[!A-Za-z0-9._-]*|.*|*/*)
    echo "worktree-create: refusing unsafe workspace name: '$name'" >&2
    exit 1
    ;;
esac

root=$(cd "$cwd" && git rev-parse --show-toplevel)
dest="$root/.claude/worktrees/$name"

if [ -e "$dest/.jj" ]; then
  # Idempotent: hook re-run for an existing workspace.
  printf '%s\n' "$dest"
  exit 0
fi

mkdir -p "$root/.claude/worktrees"

# `jj workspace add` snapshots the current workspace first (it refuses
# --ignore-working-copy). The hook runs from the clean main checkout, so that
# snapshot is a no-op. Roll back the registration if the add fails partway.
if ! jj --repository "$root" workspace add --name "$name" "$dest" >&2; then
  jj --repository "$root" --ignore-working-copy workspace forget "$name" >&2 2>&1 || true
  rm -rf "$dest"
  echo "worktree-create: jj workspace add failed for '$name'" >&2
  exit 1
fi

printf '%s\n' "$dest"
