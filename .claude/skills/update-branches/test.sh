#!/usr/bin/env bash
# Drive update.sh against a throwaway origin and jj clone, sweeping and serving
# nothing, and check that every branch lands on the new main with the review
# chain's resolutions intact.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REVIEW=$(dirname "$HERE")/review-branch/review.sh
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export JJ_USER=test JJ_EMAIL=test@example.com GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export REVIEW_REPO=$TMP/repo REVIEW_STATE=$TMP/state REVIEW_SERVE=0 UPDATE_SWEEP=true
R=$TMP/repo
FAILS=0

j() { jj -R "$R" "$@" >/dev/null 2>&1; }
q() { jj -R "$R" log --no-graph -r "$1" -T "$2"; }
check() {
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got '$2', want '$3'"; FAILS=$((FAILS + 1)); fi
}
states() { cut -f1,3 "$REVIEW_STATE/chain" | tr '\t\n' ': ' | sed 's/ $//'; }
commit_on() {
  local bm=$1 on=$2 path=$3 content=$4
  j new "$on"
  printf '%s\n' "$content" >"$R/$path"
  j commit -m "$bm: $path"
  j bookmark set "$bm" -r @-
}
# Another clone lands work on origin's main, the way a merged PR does.
land() {
  git -C "$TMP/other" pull -q
  printf '%s\n' "$2" >"$TMP/other/$1"
  git -C "$TMP/other" add -A && git -C "$TMP/other" commit -qm "main: $1" && git -C "$TMP/other" push -q
}

git init -q --bare -b main "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/other" 2>/dev/null
printf '1\n2\n3\n4\n5\n6\n7\n8\n9\n' >"$TMP/other/f"
git -C "$TMP/other" add -A && git -C "$TMP/other" commit -qm base && git -C "$TMP/other" push -q -u origin main
jj git clone "$TMP/origin.git" "$R" >/dev/null 2>&1

commit_on a main f $'1\nA\n3\n4\n5\n6\n7\n8\n9'
commit_on a2 a g 'a2'
commit_on b main f $'1\nB\n3\n4\n5\n6\n7\n8\n9'
commit_on d main d 'd'
commit_on e main e 'e'
"$REVIEW" sync >/dev/null 2>&1
mb=$(q 'description(exact:"review: merge b\n")' change_id)
j new "$mb"
printf '1\nAB\n3\n4\n5\n6\n7\n8\n9\n' >"$R/f"
j squash
j new main
"$REVIEW" sync >/dev/null 2>&1
check "the chain starts out clean" "$(states)" "clean:a clean:a2 clean:b clean:d clean:e"

land h 'main'
land d 'd'        # d lands as a squash merge
land e 'main e'   # e is rewritten under it
before=$(q 'bookmarks() ~ bookmarks(exact:"main")' 'commit_id ++ " "')
"$HERE/update.sh" >/dev/null 2>&1
check "a dry run moves no branch" "$(q 'bookmarks() ~ bookmarks(exact:"main")' 'commit_id ++ " "')" "$before"

out=$("$HERE/update.sh" --apply 2>/dev/null)
check "every branch root sits on the new main" \
  "$(q 'roots(trunk()..(bookmarks() ~ bookmarks(exact:"review")))' 'parents.map(|p| p.commit_id()).join(",") ++ " "')" \
  "$(q 'trunk()' commit_id) $(q 'trunk()' commit_id) $(q 'trunk()' commit_id) $(q 'trunk()' commit_id) "
check "a stacked bookmark follows its base" "$(q 'bookmarks(exact:"a2")-' 'local_bookmarks.join(" ")')" "a"
check "b's resolution survives" "$(jj -R "$R" file show -r review root:f | sed -n 2p)" "AB"
check "b's merge is kept, not recreated" "$(q 'description(exact:"review: merge b\n")' change_id)" "$mb"
check "the review chain sits on the new main" "$(q 'roots(trunk()..review)' 'parents.map(|p| p.commit_id())' | grep -c "$(q 'trunk()' commit_id)")" "1"
check "the squash-merged branch is reported emptied" "$(grep -c 'emptied   d ' <<<"$out")" "1"
check "the branch main rewrote is reported conflicted" "$(grep -c 'conflict  e ' <<<"$out")" "1"
check "a and b stay clean in the chain" "$(states | cut -d' ' -f1-3)" "clean:a clean:a2 clean:b"

again=$("$HERE/update.sh" --apply 2>/dev/null)
check "a second run has nothing to rebase" "$(grep -c 'every branch already sits on trunk()' <<<"$again")" "1"

[ "$FAILS" = 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
