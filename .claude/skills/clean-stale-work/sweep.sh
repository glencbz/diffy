#!/usr/bin/env bash
# Sweep diffy's local leftovers: jj workspaces, git worktrees, bookmarks, and
# the preview servers they run. Reads GitHub for the open PR list and never
# writes to it. Dry run by default; --apply executes. Safe to rerun.
set -uo pipefail
shopt -s nullglob

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# Works from any workspace: the default workspace is the repo everything hangs off.
REPO=$(jj workspace list --ignore-working-copy -T 'if(name == "default", self.root())')
[ -d "$REPO/.jj" ] || { echo "sweep: cannot find the default workspace" >&2; exit 1; }
SERVE_STATE=${DIFFY_SERVE_STATE:-/tmp/diffy-serve}
J=(jj -R "$REPO" --ignore-working-copy)

run() { if [ "$APPLY" = 1 ]; then echo "  + $*"; eval "$@"; else echo "  would: $*"; fi; }
say() { printf '%-5s %-11s %-42s %s\n' "$1" "$2" "$3" "$4"; }

# PIDs whose cwd is the directory or inside it.
pids_under() {
  local dir=$1 p cwd
  for p in /proc/[0-9]*; do
    cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
    case "$cwd" in "$dir" | "$dir"/*) echo "${p#/proc/}" ;; esac
  done
}

# A Claude session working in the directory, if any. Its presence holds the path.
session_under() {
  local p
  for p in $(pids_under "$1"); do
    case "$(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null)" in
      *claude/versions/* | claude\ *) echo "$p"; return ;;
    esac
  done
}

# `just serve` records each server's process group under /tmp/diffy-serve/<dir name>.
# Pid files outlive their servers and PIDs get reused, so a group is only
# killed while its leader still runs inside the workspace it was started in.
stop_serve() {
  local dir=$1 state="$SERVE_STATE/$(basename "$1")" f pid
  [ -n "$dir" ] && [ -d "$state" ] || return 0
  for f in "$state"/*.pid; do
    [ -e "$f" ] || continue
    pid=$(cat "$f")
    case "$(readlink "/proc/$pid/cwd" 2>/dev/null)" in
      "$dir" | "$dir"/* | "$dir (deleted)") run "kill -- -$pid 2>/dev/null" ;;
    esac
  done
  run "rm -rf '$state'"
}

# Edits on disk that jj never snapshotted, in a workspace whose @ was rewritten
# from elsewhere. Diffs the files against the tree jj last checked out there.
stale_edits() {
  local ws=$1 root=$2 op commit idx
  op=$(jj -R "$root" log -r @ 2>&1 | sed -n 's/.*not updated since operation \([0-9a-f]*\).*/\1/p')
  commit=$("${J[@]}" --at-op "$op" log --no-graph -r "\"$ws\"@" -T commit_id 2>/dev/null) ||
    { echo "cannot tell what jj last checked out"; return; }
  idx=$(mktemp)
  GIT_INDEX_FILE=$idx git -C "$REPO" read-tree "$commit"
  GIT_INDEX_FILE=$idx git --git-dir="$REPO/.git" --work-tree="$root" update-index -q --refresh >/dev/null
  { GIT_INDEX_FILE=$idx git --git-dir="$REPO/.git" --work-tree="$root" diff-files --name-only
    GIT_INDEX_FILE=$idx git --git-dir="$REPO/.git" --work-tree="$root" ls-files --others --exclude-standard --exclude=/.jj/; } |
    head -3 | tr '\n' ' '
  rm -f "$idx"
}

# Everything else still running in a path about to be deleted. By PID, never pkill.
kill_under() {
  local p
  for p in $(pids_under "$1"); do run "kill $p 2>/dev/null"; done
}

revs() { "${J[@]}" log --no-graph -r "$1" -T "$2" 2>/dev/null; }

echo "### state"
echo "restore point: $("${J[@]}" op log --no-graph -n1 -T 'id.short()')  (jj op restore <id> undoes everything after it, other sessions' work included)"
# --ignore-working-copy skips the automatic import, so branches git made go unseen.
"${J[@]}" git import --quiet
"${J[@]}" --config git.abandon-unreachable-commits=false git fetch --remote origin --quiet 2>&1 | sed 's/^/  /'
OPEN=$(GH_HOST=github.int.exe.xyz gh api '/repos/glencbz/diffy/pulls?state=open&per_page=100' --jq '.[].head.ref' | tr '\n' ' ') ||
  { echo "sweep: cannot read open PRs; refusing to classify without them" >&2; exit 1; }
echo "open PR heads: $OPEN"

OPEN_REVS="none()"
for b in $OPEN; do OPEN_REVS="$OPEN_REVS | present(bookmarks(exact:\"$b\")) | present(remote_bookmarks(exact:\"$b\", remote=exact:\"origin\"))"; done
PUBLISHED="trunk() | remote_bookmarks(remote=exact:\"origin\")"
HELD_REVS="none()"
KEEP_BRANCHES="main $OPEN"

echo
echo "### jj workspaces"
while IFS=$'\t' read -r ws root; do
  [ "$ws" = default ] && continue
  # jj reports no root once the directory is gone; its serve state is swept below.
  if [ -z "$root" ] || [ ! -d "$root" ]; then
    say drop workspace "$ws" "directory already gone"
    run "${J[*]} workspace forget '$ws'"
    continue
  fi
  if pid=$(session_under "$root") && [ -n "$pid" ]; then
    say hold workspace "$ws" "live Claude session, pid $pid"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  # Running jj inside the workspace snapshots edits into @, so the checks below see them.
  if ! jj -R "$root" log -r @ --no-graph -T '' >/dev/null 2>&1; then
    edits=$(stale_edits "$ws" "$root")
    if [ -n "$edits" ]; then
      say hold workspace "$ws" "stale, with edits jj never saw: $edits"
      HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
    fi
  fi
  on_pr=$(revs "::\"$ws\"@ & (::($OPEN_REVS) ~ ::trunk())" 'change_id.short() ++ " "' | head -c 60)
  if [ -n "$on_pr" ]; then
    say hold workspace "$ws" "builds on an open PR ($on_pr)"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  unique=$(revs "(::\"$ws\"@ ~ ::($PUBLISHED)) ~ empty()" 'change_id.short() ++ " "')
  if [ -n "$unique" ]; then
    say hold workspace "$ws" "unpublished changes: $unique"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  say drop workspace "$ws" "nothing unpublished, no open PR"
  stop_serve "$root"
  kill_under "$root"
  run "${J[*]} workspace forget '$ws'"
  run "rm -rf '$root'"
done < <("${J[@]}" workspace list -T 'name ++ "\t" ++ self.root() ++ "\n"')

echo
echo "### git worktrees"
while read -r path; do
  [ "$path" = "$REPO" ] && continue
  name=$(basename "$path")
  branch=$(git -C "$path" symbolic-ref --quiet --short HEAD 2>/dev/null)
  hold=""
  if pid=$(session_under "$path") && [ -n "$pid" ]; then hold="live Claude session, pid $pid"
  elif [ -d "$path" ] && [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then hold="uncommitted edits (jj cannot see them)"
  elif [ -d "$path" ] && [ -z "$(git -C "$REPO" for-each-ref --contains "$(git -C "$path" rev-parse HEAD)" refs/remotes/origin)" ]; then hold="HEAD is on no origin branch"
  fi
  if [ -n "$hold" ]; then
    say hold worktree "$name" "$hold"
    # Forgetting a branch a held worktree has checked out would dangle its HEAD.
    [ -n "$branch" ] && KEEP_BRANCHES="$KEEP_BRANCHES $branch"
    continue
  fi
  say drop worktree "$name" "clean and published"
  stop_serve "$path"
  kill_under "$path"
  run "git -C '$REPO' worktree unlock '$path' 2>/dev/null"
  run "git -C '$REPO' worktree remove -f -f '$path' 2>/dev/null"
  run "rm -rf '$path'"
done < <(git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p')
run "git -C '$REPO' worktree prune"

echo
echo "### directories nothing tracks"
tracked=$( { "${J[@]}" workspace list -T 'self.root() ++ "\n"'; git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p'; } )
for d in "$REPO"/.claude/worktrees/*/; do
  d=${d%/}
  grep -qxF "$d" <<<"$tracked" && continue
  [ "$APPLY" = 1 ] && [ ! -d "$d" ] && continue
  say hold directory "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1), in neither jj nor git: look inside, then rm -rf"
done
for s in "$SERVE_STATE"/*/; do
  s=$(basename "$s")
  [ "$s" = "$(basename "$REPO")" ] && continue
  [ -d "$REPO/.claude/worktrees/$s" ] && continue
  say drop serve "$s" "state for a workspace that no longer exists"
  stop_serve "$REPO/.claude/worktrees/$s"
done

echo
echo "### bookmarks"
while IFS=$'\t' read -r bm present; do
  case " $KEEP_BRANCHES " in *" $bm "*) say keep bookmark "$bm" "main, an open PR, or a held worktree's branch"; continue ;; esac
  if [ "$present" = false ]; then
    # A deleted-but-tracked bookmark deletes the GitHub branch on the next push.
    say drop bookmark "$bm" "pending deletion that a push would carry to GitHub"
  elif [ -n "$(revs "bookmarks(exact:\"$bm\") & (::($HELD_REVS) ~ ::trunk())" '"x"')" ]; then
    say keep bookmark "$bm" "a held workspace builds on it"; continue
  elif [ -n "$(revs "bookmarks(exact:\"$bm\") & ::trunk()" '"x"')" ]; then
    say drop bookmark "$bm" "merged into main"
  elif [ -n "$(revs "bookmarks(exact:\"$bm\") & ::remote_bookmarks(remote=exact:\"origin\")" '"x"')" ]; then
    say drop bookmark "$bm" "on GitHub already, no open PR"
  else
    say hold bookmark "$bm" "commits exist nowhere else"; continue
  fi
  run "${J[*]} bookmark forget --include-remotes 'exact:$bm'"
done < <("${J[@]}" bookmark list -T 'if(!remote, name ++ "\t" ++ present ++ "\n")' 2>/dev/null)

echo
echo "### commits nothing points at (left in place; read, then jj abandon if dead)"
revs "heads(all()) ~ ::(trunk() | bookmarks() | remote_bookmarks() | working_copies())" \
  'change_id.short() ++ "  " ++ committer.timestamp().ago() ++ "  " ++ description.first_line() ++ "\n"' | sed 's/^/  /'

[ "$APPLY" = 1 ] || printf '\ndry run. Re-run with --apply to execute.\n'
