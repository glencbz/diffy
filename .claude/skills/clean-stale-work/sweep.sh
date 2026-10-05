#!/usr/bin/env bash
# Sweep diffy's local leftovers: jj workspaces, git worktrees, bookmarks, and
# the preview servers they run. Reads GitHub for the open PR list and never
# writes to it. Dry run by default; --apply executes. Safe to rerun.
#
#   sweep.sh                         print the plan
#   sweep.sh --apply                 sweep, then refresh the previews it kept
#   sweep.sh --apply --no-previews   sweep only (update.sh refreshes after its rebase)
#   sweep.sh --previews              refresh the previews only
set -uo pipefail
shopt -s nullglob

APPLY=0 SWEEP=1 PREVIEWS=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 PREVIEWS=1 ;;
    --no-previews) PREVIEWS=0 ;;
    --previews) APPLY=1 SWEEP=0 PREVIEWS=1 ;;
  esac
done

# Works from any workspace: the default workspace is the repo everything hangs off.
REPO=$(jj workspace list --ignore-working-copy -T 'if(name == "default", self.root())')
[ -d "$REPO/.jj" ] || { echo "sweep: cannot find the default workspace" >&2; exit 1; }
SERVE_STATE=${DIFFY_SERVE_STATE:-/tmp/diffy-serve}
# Non-ignored files of each untracked directory, saved before it is deleted.
ARCHIVE=${SWEEP_ARCHIVE:-$HOME/.cache/diffy-sweep}
# A session's Claude process keeps its cwd in the main checkout, so a workspace
# it is busy in shows no process. Recent writes are the only sign it is in use.
FRESH_MINUTES=${SWEEP_FRESH_MINUTES:-5}
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
    case "$(tr '\0' ' ' 2>/dev/null <"/proc/$p/cmdline")" in
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

# A file written in the directory within FRESH_MINUTES, if any.
fresh() {
  find "$1" \( -name node_modules -o -name .venv -o -name .git \) -prune -o \
    -type f -mmin "-$FRESH_MINUTES" -print -quit 2>/dev/null | grep -q .
}

# The app port a preview server still serves from the directory, if any.
serving() {
  local dir=$1 state="$SERVE_STATE/$(basename "$1")" f pid
  for f in "$state"/*.pid; do
    pid=$(cat "$f")
    case "$(readlink "/proc/$pid/cwd" 2>/dev/null)" in
      "$dir" | "$dir"/*) echo ":$(sed -n 's/^app=//p' "$state/ports" 2>/dev/null)"; return ;;
    esac
  done
  return 1
}

# Why the preview a directory serves on the port is still wanted, if it is:
# an open PR links it, or someone started it or wrote there recently.
preview_wanted() {
  local dir=$1 port=${2#:} f pid
  case " $LINKED " in *" $port "*) echo "an open PR links it"; return ;; esac
  for f in "$SERVE_STATE/$(basename "$dir")"/*.pid; do
    pid=$(cat "$f")
    [ "$(ps -o etimes= -p "$pid" 2>/dev/null || echo 999999)" -lt $((FRESH_MINUTES * 60)) ] &&
      { echo "started in the last $FRESH_MINUTES minutes"; return; }
  done
  fresh "$dir" && { echo "written to in the last $FRESH_MINUTES minutes"; return; }
  return 1
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
    grep -v '^\.jjconflict-' | head -3 | tr '\n' ' '
  rm -f "$idx"
}

# Everything else still running in a path about to be deleted. By PID, never pkill.
kill_under() {
  local p
  for p in $(pids_under "$1"); do run "kill $p 2>/dev/null"; done
}

revs() { "${J[@]}" log --no-graph -r "$1" -T "$2" 2>/dev/null; }

# A preview server outlives the code it serves once a rebase rewrites its
# workspace's @. Each one that no live session owns is stopped, moved onto the
# rewritten @, and served again on the ports its PR body links to.
refresh_previews() {
  local ws root ports pid edits
  echo
  echo "### previews"
  while IFS=$'\t' read -r ws root; do
    { [ "$ws" = review ] || [ ! -d "$root" ]; } && continue
    ports=$(serving "$root") || continue
    if pid=$(session_under "$root") && [ -n "$pid" ]; then
      say keep preview "$ws" "$ports, live Claude session pid $pid refreshes its own"; continue
    fi
    if jj -R "$root" log -r @ --no-graph -T '' >/dev/null 2>&1; then
      say keep preview "$ws" "$ports, already serves its @"; continue
    fi
    edits=$(stale_edits "$ws" "$root")
    if [ -n "$edits" ]; then
      say hold preview "$ws" "$ports, stale with edits jj never saw: $edits"; continue
    fi
    say restart preview "$ws" "$ports, its @ was rewritten"
    run "jj -R '$root' workspace update-stale >/dev/null 2>&1"
    run "(cd '$root' && GH_HOST=github.int.exe.xyz just serve >/dev/null)"
  done < <("${J[@]}" workspace list -T 'name ++ "\t" ++ self.root() ++ "\n"')
}

if [ "$SWEEP" = 0 ]; then refresh_previews; exit 0; fi

echo "### state"
echo "restore point: $("${J[@]}" op log --no-graph -n1 -T 'id.short()')  (jj op restore <id> undoes everything after it, other sessions' work included)"
# --ignore-working-copy skips the automatic import, so branches git made go unseen.
"${J[@]}" git import --quiet
"${J[@]}" --config git.abandon-unreachable-commits=false git fetch --remote origin --quiet 2>&1 | sed 's/^/  /'
PULLS=$(GH_HOST=github.int.exe.xyz gh api '/repos/glencbz/diffy/pulls?state=open&per_page=100') ||
  { echo "sweep: cannot read open PRs; refusing to classify without them" >&2; exit 1; }
OPEN=$(jq -r '.[].head.ref' <<<"$PULLS" | tr '\n' ' ')
# Ports the open PRs' preview URLs point at.
LINKED=$(jq -r '.[].body // ""' <<<"$PULLS" | grep -o 'exe\.xyz:[0-9]*' | cut -d: -f2 | sort -u | tr '\n' ' ')
echo "open PR heads: $OPEN"
echo "linked preview ports: $LINKED"

PUBLISHED="trunk() | remote_bookmarks(remote=exact:\"origin\")"
HELD_REVS="none()"
KEEP_BRANCHES="main $OPEN"

echo
echo "### jj workspaces"
while IFS=$'\t' read -r ws root; do
  [ "$ws" = default ] && continue
  # The review-branch watcher owns its workspace. Between syncs its @ can sit on
  # trunk() with nothing unpublished, which looks dead to the checks below.
  if [ "$ws" = review ]; then say keep workspace "$ws" "the review-branch watcher's"; HELD_REVS="$HELD_REVS | \"$ws\"@"; continue; fi
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
  # A preview still in use is refreshed after the sweep rather than killed.
  if ports=$(serving "$root") && why=$(preview_wanted "$root" "$ports"); then
    say keep workspace "$ws" "serves $ports, $why"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  if fresh "$root"; then
    say hold workspace "$ws" "written to in the last $FRESH_MINUTES minutes"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  unique=$(revs "(::\"$ws\"@ ~ ::($PUBLISHED)) ~ empty()" 'change_id.short() ++ " "')
  if [ -n "$unique" ]; then
    say hold workspace "$ws" "unpublished changes: $unique"
    HELD_REVS="$HELD_REVS | \"$ws\"@"; continue
  fi
  say drop workspace "$ws" "nothing unpublished${ports:+, preview on $ports unused}"
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
  name=$(basename "$d")
  if pid=$(session_under "$d") && [ -n "$pid" ]; then say hold directory "$name" "live Claude session, pid $pid"; continue; fi
  # Nothing could restart a server here once the directory is gone.
  if ports=$(serving "$d") && why=$(preview_wanted "$d" "$ports"); then say hold directory "$name" "serves $ports, $why"; continue; fi
  if fresh "$d"; then say hold directory "$name" "written to in the last $FRESH_MINUTES minutes"; continue; fi
  say drop directory "$name" "in neither jj nor git${ports:+, preview on $ports unused}; files kept in $ARCHIVE/$name.tgz"
  run "mkdir -p '$ARCHIVE' && GIT_INDEX_FILE=\$(mktemp -u) git --git-dir='$REPO/.git' --work-tree='$d' ls-files --others --exclude-standard --exclude=/.jj/ | tar -czf '$ARCHIVE/$name.tgz' -C '$d' -T -"
  kill_under "$d"
  run "rm -rf '$d'"
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

[ "$PREVIEWS" = 1 ] && refresh_previews
[ "$APPLY" = 1 ] || printf '\ndry run. Re-run with --apply to execute.\n'
