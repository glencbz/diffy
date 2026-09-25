#!/usr/bin/env bash
# Verification harness for diffy: start / doctor / stop one throwaway instance.
#
# The instance serves the real routes from src/server.ts, but on an ephemeral
# port and with its jj log pointed at a throwaway fixture repo, so a run never
# touches the developer's port-3000 instance or their own repo state.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RUN_DIR="${DIFFY_VERIFY_RUN_DIR:-/tmp/diffy-verify/${DIFFY_VERIFY_RUN_ID:-default}}"
FIXTURE="$RUN_DIR/repo"
PID_FILE="$RUN_DIR/server.pid"
URL_FILE="$RUN_DIR/url"
LOG_FILE="$RUN_DIR/server.log"
EARLY_OP_FILE="$RUN_DIR/early-op"
# The same pinned toolchain `just run` uses, so difftastic is on the server's PATH.
RUNTIME=(nix --extra-experimental-features 'nix-command flakes' develop "path:$REPO/nix#runtime" -c)

die() { echo "verify: $*" >&2; exit 1; }

running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

build_fixture() {
  [ -d "$FIXTURE/.jj" ] && return 0
  export JJ_USER="Diffy Verify" JJ_EMAIL="verify@example.invalid"
  mkdir -p "$FIXTURE"
  jj git init "$FIXTURE" >/dev/null 2>&1
  {
  (
    cd "$FIXTURE"
    printf 'line one\n' > notes.txt
    jj commit -m 'fixture: add the notes file' >/dev/null
    # The full operation id of "just one commit exists": the value the
    # operation picker's <option> carries, and what /api/log?op= wants.
    jj op log --no-graph -n1 -T 'id' > "$EARLY_OP_FILE"
    printf 'line two\n' >> notes.txt
    jj commit -m 'fixture: extend the notes file' >/dev/null
    jj new 'description(substring:"add the notes file")' >/dev/null
    printf 'sidecar\n' > sidecar.txt
    jj commit -m 'fixture: add a sidecar file' >/dev/null
    jj new 'description(substring:"extend the notes file")' \
           'description(substring:"add a sidecar file")' >/dev/null
    jj commit -m 'fixture: merge the two topics' >/dev/null
    jj describe -m 'fixture: an empty change' >/dev/null
    # A second topic off the root, apart from the merge, whose files trip the
    # diff pane's folding, context gaps, file summary and deleted status.
    jj new 'root()' >/dev/null
    seq -f 'long line %g' 1 60 > long.txt
    printf 'lockfileVersion: 1\n' > bun.lock
    printf 'function greet(name) {\n  return "hi " + name;\n}\n' > greet.js
    jj commit -m 'fixture: add a long file, a lock file and a script' >/dev/null
    sed -i -e 's/^long line 2$/long line two/' -e 's/^long line 58$/long line fifty-eight/' long.txt
    rm bun.lock
    sed -i 's/"hi "/"hello, " + "there "/' greet.js
    jj commit -m 'fixture: edit the long file and the script' >/dev/null
    jj abandon @ >/dev/null
    jj edit 'description(substring:"an empty change")' >/dev/null
  )
  } 2> "$RUN_DIR/fixture.log" || { cat "$RUN_DIR/fixture.log" >&2; die "fixture build failed"; }
}

cmd_start() {
  if running; then cat "$URL_FILE"; return 0; fi
  mkdir -p "$RUN_DIR"
  build_fixture
  ( cd "$FIXTURE" && NODE_ENV=production exec "${RUNTIME[@]}" bun run "$REPO/.claude/skills/verify-diffy/harness/serve.ts" ) \
    > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  for _ in $(seq 100); do
    if grep -qs 'Listening on' "$LOG_FILE"; then
      sed -n 's#.*Listening on \(http[^ ]*\)/*#\1#p' "$LOG_FILE" | head -1 \
        | sed 's#/$##' > "$URL_FILE"
      cat "$URL_FILE"
      return 0
    fi
    running || { cat "$LOG_FILE" >&2; die "server exited during startup"; }
    sleep 0.1
  done
  cat "$LOG_FILE" >&2
  die "server did not report a listening URL within 10s"
}

cmd_doctor() {
  running || die "no instance running (run: verify.sh start)"
  local pid url log
  pid="$(cat "$PID_FILE")"
  url="$(cat "$URL_FILE")"
  log="$(curl -fsS --max-time 5 "$url/api/log")" || die "$url/api/log did not answer"
  echo "$log" | grep -q 'fixture: an empty change' \
    || die "$url is not serving the verification fixture (unexpected /api/log body)"
  echo "pid       $pid ($(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-60))"
  echo "url       $url"
  echo "fixture   $FIXTURE"
  echo "early op  $(cat "$EARLY_OP_FILE")"
  echo "commits   $(echo "$log" | grep -o '"changeId"' | wc -l) from /api/log"
  echo "OK"
}

cmd_stop() {
  if [ -f "$PID_FILE" ]; then kill "$(cat "$PID_FILE")" 2>/dev/null || true; fi
  rm -rf "$RUN_DIR"
  echo "stopped; artifacts under $REPO/.claude/verify-artifacts are untouched"
}

case "${1:-}" in
  start)  cmd_start ;;
  doctor) cmd_doctor ;;
  stop)   cmd_stop ;;
  url)    running && cat "$URL_FILE" || die "no instance running" ;;
  *) die "usage: verify.sh {start|doctor|stop|url}" ;;
esac
