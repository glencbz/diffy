#!/usr/bin/env bash
# Keep one review branch that merges every WIP bookmark, and serve it on fixed
# ports. The branch is a chain of merge commits on trunk(), one per bookmark,
# each holding only the resolution of its own bookmark against the ones below
# it. jj reapplies that resolution whenever either side moves, so a conflict is
# resolved once and reused until the code around it changes.
#
#   review.sh start    run `watch` detached, unless it already runs
#   review.sh stop     stop the watcher and the server
#   review.sh status   print the chain, its conflicts, and the URLs
#   review.sh sync     rebuild the chain once and refresh the server
#   review.sh watch    sync whenever trunk() or a bookmark moves
set -euo pipefail

WS=${REVIEW_WORKSPACE:-review}
BM=${REVIEW_BOOKMARK:-review}
APP_PORT=${REVIEW_APP_PORT:-4000}
DOCS_PORT=${REVIEW_DOCS_PORT:-9000}
STATE=${REVIEW_STATE:-/tmp/diffy-review}
SERVE=${REVIEW_SERVE:-1}
POLL=${REVIEW_POLL:-3}
SETTLE=${REVIEW_SETTLE:-5}
PREFIX="review: merge "

# The default workspace is the repo everything hangs off, wherever this runs from.
REPO=${REVIEW_REPO:-$(jj workspace list --ignore-working-copy -T 'if(name == "default", self.root())')}
[ -d "$REPO/.jj" ] || { echo "review: cannot find the default workspace" >&2; exit 1; }
export REVIEW_REPO=$REPO
WS_ROOT=$REPO/.claude/worktrees/$WS
J=(jj -R "$REPO" --ignore-working-copy)
mkdir -p "$STATE"

q() { local r=$1 t=$2; shift 2; "${J[@]}" log --no-graph -r "$r" -T "$t" "$@"; }
log() { echo "$(date -u +%FT%TZ) $*"; }
port_open() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null; }

# Local bookmarks with work not on trunk(), oldest tip first.
wip() {
  "${J[@]}" bookmark list -r 'bookmarks() ~ ::trunk()' \
    -T 'if(!remote && present && !conflict && name != "'"$BM"'",
          normal_target.committer().timestamp().format("%s") ++ "\t" ++ name ++ "\n")' |
    sort -n | cut -f2
}

# The chain as it stands, bottom first: change id, divergent, bookmark name.
chain() {
  q "::bookmarks(exact:\"$BM\") & description(regex:\"^$PREFIX\")" \
    'change_id ++ "\t" ++ divergent ++ "\t" ++ description.first_line().remove_prefix("'"$PREFIX"'") ++ "\n"' \
    --reversed
}

ensure_workspace() {
  [ -d "$WS_ROOT/.jj" ] && return
  "${J[@]}" workspace forget "$WS" 2>/dev/null || true
  mkdir -p "$(dirname "$WS_ROOT")"
  jj -R "$REPO" workspace add --name "$WS" -r 'trunk()' "$WS_ROOT"
}

do_sync() {
  ensure_workspace
  local -A old=() live=()
  local order=() name cid div
  while IFS=$'\t' read -r cid div name; do
    if [ "$div" = true ]; then
      echo "review: $PREFIX$name is divergent; jj abandon one copy, then sync" >&2
      return 1
    fi
    old[$name]=$cid
    order+=("$name")
  done < <(chain)
  while read -r name; do live[$name]=1; done < <(wip)

  # Merges keep their place, so a bookmark that moves only disturbs the ones above it.
  local next=()
  for name in "${order[@]}"; do [ -n "${live[$name]:-}" ] && next+=("$name"); done
  while read -r name; do [ -z "${old[$name]:-}" ] && next+=("$name"); done < <(wip)

  local prev tip parents
  prev=$(q 'trunk()' commit_id)
  for name in "${next[@]}"; do
    tip=$(q "bookmarks(exact:\"$name\")" commit_id)
    cid=${old[$name]:-}
    if [ -n "$cid" ]; then
      parents=$(q "$cid" 'parents.map(|p| p.commit_id()).join(" ")')
      if [ "$parents" != "$prev $tip" ]; then
        log "move $name onto its new parents"
        "${J[@]}" rebase -s "$cid" -o "$prev" -o "$tip"
      fi
    else
      log "add $name"
      "${J[@]}" new --no-edit "$prev" "$tip" -m "$PREFIX$name"
      cid=$(q "latest(children($prev) & children($tip) & description(exact:\"$PREFIX$name\n\"))" change_id)
    fi
    prev=$(q "$cid" commit_id)
  done
  for name in "${order[@]}"; do
    [ -n "${live[$name]:-}" ] && continue
    log "drop $name"
    "${J[@]}" abandon "${old[$name]}"
  done
  "${J[@]}" bookmark set "$BM" -r "$prev" --allow-backwards

  # Serve everything below the first merge that conflicts: a tree with
  # conflict markers in it does not build.
  local served state
  served=$(q 'trunk()' commit_id)
  : >"$STATE/chain.new"
  state=clean
  while IFS=$'\t' read -r cid div name; do
    if [ "$state" = clean ] && [ "$(q "$cid" conflict)" = true ]; then state=conflict
    elif [ "$state" = conflict ]; then state=blocked
    fi
    [ "$state" = clean ] && served=$(q "$cid" commit_id)
    printf '%s\t%s\t%s\n' "$state" "$(q "$cid" 'change_id.short()')" "$name" >>"$STATE/chain.new"
  done < <(chain)
  mv "$STATE/chain.new" "$STATE/chain"

  if [ "$(q "\"$WS\"@" 'parents.map(|p| p.commit_id()).join(" ")')" != "$served" ]; then
    if [ "$(q "\"$WS\"@" empty)" != true ]; then
      echo "review: $WS@ has edits; move them out, nothing should change files there" >&2
    fi
    log "check out $(q "$served" 'change_id.short()') in $WS"
    jj -R "$WS_ROOT" --ignore-working-copy new "$served"
  fi
  jj -R "$WS_ROOT" workspace update-stale >/dev/null 2>&1 || true
  [ "$SERVE" = 1 ] || return 0
  if [ "$(cat "$STATE/served" 2>/dev/null)" != "$served" ] || ! port_open "$APP_PORT"; then
    # The servers outlive this sync and must not inherit its lock.
    serve 9>&- && echo "$served" >"$STATE/served"
  fi
}

# `just serve` keeps the ports it finds in its state file, so writing them
# first pins the review server to the same URLs across restarts and reboots.
serve() {
  local serve_state=/tmp/diffy-serve/$WS
  mkdir -p "$serve_state"
  printf 'app=%s\ndocs=%s\n' "$APP_PORT" "$DOCS_PORT" >"$serve_state/ports"
  (
    cd "$WS_ROOT"
    [ -d node_modules ] || just install
    log "serve $(jj --ignore-working-copy log --no-graph -r @- -T 'change_id.short()')"
    GH_HOST=github.int.exe.xyz just serve
  )
}

sync() { ( flock 9; do_sync ) 9>"$STATE/lock"; }

# Only bookmarks and trunk() feed the chain. Waiting for them to hold still
# keeps the watcher from rewriting a merge while a session is mid-restack.
fingerprint() { q 'trunk() | bookmarks()' 'commit_id ++ " " ++ bookmarks ++ "\n"'; }

watch() {
  echo $$ >"$STATE/watch.pid"
  local last="" fp
  while :; do
    fp=$(fingerprint 2>/dev/null) || fp=""
    if [ "$fp" != "$last" ] || { [ "$SERVE" = 1 ] && ! port_open "$APP_PORT"; }; then
      sleep "$SETTLE"
      if [ "$(fingerprint 2>/dev/null)" = "$fp" ]; then
        sync || { log "sync failed; retrying on the next change"; sleep 30; }
        # The sync moves $BM itself; start from what it left.
        last=$(fingerprint 2>/dev/null) || last=""
      fi
    fi
    sleep "$POLL"
  done
}

watcher_pid() {
  local pid
  pid=$(cat "$STATE/watch.pid" 2>/dev/null) || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q "$STATE/review.sh watch" || return 1
  echo "$pid"
}

start() {
  if pid=$(watcher_pid); then
    if cmp -s "$0" "$STATE/review.sh"; then echo "review: watcher already running, pid $pid"; return; fi
    kill -- "-$pid"
  fi
  # Run a copy: bash reads a script as it goes, and a checkout that rewrites
  # this file under a running watcher would derail it.
  cp "$0" "$STATE/review.sh"
  (cd "$REPO" && setsid bash "$STATE/review.sh" watch >>"$STATE/watch.log" 2>&1 </dev/null &)
  echo "review: watcher started; log in $STATE/watch.log"
}

stop() {
  if pid=$(watcher_pid); then kill -- "-$pid"; fi
  rm -f "$STATE/watch.pid"
  [ "$SERVE" = 1 ] && [ -d "$WS_ROOT" ] && (cd "$WS_ROOT" && just serve-stop)
  return 0
}

status() {
  if pid=$(watcher_pid); then echo "watcher  running, pid $pid"; else echo "watcher  stopped"; fi
  echo "app      https://$(hostname).exe.xyz:$APP_PORT/  $(port_open "$APP_PORT" && echo up || echo down)"
  echo "docs     https://$(hostname).exe.xyz:$DOCS_PORT/  $(port_open "$DOCS_PORT" && echo up || echo down)"
  echo "serving  $(q "\"$WS\"@-" 'change_id.short() ++ " " ++ description.first_line()' 2>/dev/null)"
  echo
  column -t -s $'\t' "$STATE/chain" 2>/dev/null || echo "no chain yet"
}

case "${1:-}" in
  start | stop | status | sync | watch) "$1" ;;
  *) sed -n '8,12p' "$0" >&2; exit 2 ;;
esac
