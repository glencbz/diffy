#!/usr/bin/env bash
# Drive review.sh against a throwaway jj repo, serving nothing, and check that
# a conflict resolved once in the chain survives every way its inputs move.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'REVIEW_STATE=$TMP/state "$HERE/review.sh" stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
export JJ_USER=test JJ_EMAIL=test@example.com
export REVIEW_REPO=$TMP/repo REVIEW_STATE=$TMP/state REVIEW_SERVE=0 REVIEW_POLL=0.2 REVIEW_SETTLE=0.2
R=$TMP/repo
WS=$R/.claude/worktrees/review
FAILS=0

j() { jj -R "$R" "$@" >/dev/null 2>&1; }
sync() { "$HERE/review.sh" sync >/dev/null; }
check() {
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got '$2', want '$3'"; FAILS=$((FAILS + 1)); fi
}
states() { cut -f1,3 "$REVIEW_STATE/chain" | tr '\t\n' ': ' | sed 's/ $//'; }
file() { cat "$WS/$1"; }
# Commit on top of a bookmark and move it there, the way a session updates a branch.
commit_on() {
  local bm=$1 path=$2 content=$3
  j new "$bm" || j new main
  printf '%s\n' "$content" >"$R/$path"
  j commit -m "$bm: $path"
  j bookmark set "$bm" -r @- --allow-backwards
}

mkdir -p "$R" && cd "$R"
jj git init . >/dev/null 2>&1
j config set --repo 'revset-aliases."trunk()"' main
printf '1\n2\n3\n4\n5\n6\n7\n8\n9\n' >f
j commit -m base
j bookmark set main -r @-
commit_on a f $'1\nA\n3\n4\n5\n6\n7\n8\n9'
commit_on b f $'1\nB\n3\n4\n5\n6\n7\n8\n9'
commit_on c g 'c'

sync
check "a and b conflict; c waits above them" "$(states)" "clean:a conflict:b blocked:c"
check "the workspace serves what is below the conflict" "$(file f | sed -n 2p)" "A"

# Resolve the conflict once, in b's merge.
mb=$(jj -R "$R" log --no-graph -r 'description(exact:"review: merge b\n")' -T change_id)
j new "$mb"
printf '1\nAB\n3\n4\n5\n6\n7\n8\n9\n' >"$R/f"
j squash
sync
check "resolving b's merge unblocks the chain" "$(states)" "clean:a clean:b clean:c"
check "the workspace serves the whole chain" "$(file f | sed -n 2p) $(file g)" "AB c"

commit_on c g 'c2'
sync
check "a change above b keeps b's resolution" "$(states) $(file f | sed -n 2p) $(file g)" "clean:a clean:b clean:c AB c2"

j edit a
printf '1\nA\n3\n4\n5\n6\n7\n8\na9\n' >"$R/f"
j new main
sync
check "amending a keeps b's resolution" "$(states) $(file f | tr '\n' ,)" "clean:a clean:b clean:c 1,AB,3,4,5,6,7,8,a9,"

commit_on b f $'1\nB\n3\n4\nb5\n6\n7\n8\n9'
sync
check "moving b to a new commit keeps its resolution" "$(states) $(file f | tr '\n' ,)" "clean:a clean:b clean:c 1,AB,3,4,b5,6,7,8,a9,"

j new main
printf 'main\n' >"$R/h"
j commit -m 'main moves'
j bookmark set main -r @-
sync
check "trunk moving keeps the resolution" "$(states) $(file f | sed -n 2p) $(file h)" "clean:a clean:b clean:c AB main"

j rebase -b a -o main
j bookmark set main -r a
sync
check "a landing drops its merge and keeps b's" "$(states) $(file f | tr '\n' ,)" "clean:b clean:c 1,AB,3,4,b5,6,7,8,a9,"

commit_on d e 'd'
sync
check "a new bookmark goes on top" "$(states)" "clean:b clean:c clean:d"
check "each merge is kept, not recreated" \
  "$(jj -R "$R" log --no-graph -r 'description(exact:"review: merge b\n")' -T change_id)" "$mb"

"$HERE/review.sh" start >/dev/null
commit_on d e 'd2'
for _ in $(seq 50); do [ "$(file e 2>/dev/null)" = d2 ] && break; sleep 0.2; done
check "the watcher follows a bookmark that moves" "$(file e)" "d2"
"$HERE/review.sh" stop >/dev/null
check "stop ends the watcher" "$("$HERE/review.sh" status | head -1)" "watcher  stopped"

[ "$FAILS" = 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
