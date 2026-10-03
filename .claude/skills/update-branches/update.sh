#!/usr/bin/env bash
# Bring every local branch up to date with origin's main: fetch, sweep what is
# dead, rebase every WIP bookmark onto trunk(), rebuild the review chain, and
# push each open PR's branch that came out clean. Dry run by default; --apply
# executes. Safe to rerun, and rerunning after resolving a conflict pushes the
# branch it held back.
#
#   update.sh           fetch, then print the sweep plan and what would move
#   update.sh --apply   sweep, rebase, sync the chain, push, report conflicts
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
HERE=$(cd "$(dirname "$0")" && pwd)
SKILLS=$(dirname "$HERE")
SWEEP=${UPDATE_SWEEP:-$SKILLS/clean-stale-work/sweep.sh}
REVIEW=${UPDATE_REVIEW:-$SKILLS/review-branch/review.sh}
BM=${REVIEW_BOOKMARK:-review}
# Space-separated head branches of the open PRs. Read from GitHub unless set.
OPEN=${UPDATE_OPEN_PRS-}

REPO=${REVIEW_REPO:-$(jj workspace list --ignore-working-copy -T 'if(name == "default", self.root())')}
[ -d "$REPO/.jj" ] || { echo "update: cannot find the default workspace" >&2; exit 1; }
export REVIEW_REPO=$REPO
J=(jj -R "$REPO" --ignore-working-copy)
q() { local r=$1 t=$2; shift 2; "${J[@]}" log --no-graph -r "$r" -T "$t" "$@"; }

# The same set the review chain merges: local bookmarks with work not on trunk().
WIP="(bookmarks() ~ ::trunk()) ~ bookmarks(exact:\"$BM\")"
ROOTS="roots(trunk()..($WIP))"

echo "### fetch"
for delay in 2 4 8 16 0; do
  "${J[@]}" --config git.abandon-unreachable-commits=false git fetch --remote origin && break
  [ "$delay" = 0 ] && { echo "update: fetch failed" >&2; exit 1; }
  sleep "$delay"
done
if [ "$(q 'present(bookmarks(exact:"main"))' 'conflict')" = true ]; then
  echo "update: main is conflicted locally; settle it before rebasing onto it" >&2
  exit 1
fi
echo "restore point: $("${J[@]}" op log --no-graph -n1 -T 'id.short()')"

echo
echo "### sweep"
if [ "$APPLY" = 1 ]; then "$SWEEP" --apply; else "$SWEEP"; fi

echo
echo "### rebase onto $(q 'trunk()' 'commit_id.short() ++ " " ++ description.first_line()')"
stale=$(q "$ROOTS ~ children(trunk())" 'change_id.short() ++ "  " ++ local_bookmarks.map(|b| b.name()).join(" ") ++ "  " ++ description.first_line() ++ "\n"')
if [ -z "$stale" ]; then
  echo "every branch already sits on trunk()"
elif [ "$APPLY" = 1 ]; then
  echo "$stale" | sed 's/^/  /'
  # One rebase moves every root with its descendants, the review merges included,
  # so jj rewrites each merge once and carries its resolution along.
  "${J[@]}" rebase -s "$ROOTS ~ children(trunk())" -o 'trunk()'
else
  echo "$stale" | sed 's/^/  would rebase: /'
fi

[ "$APPLY" = 1 ] || { printf '\ndry run. Re-run with --apply to execute.\n'; exit 0; }

echo
echo "### review chain"
"$REVIEW" sync || echo "update: review sync failed; see the review-branch skill"
"$REVIEW" status | sed -n '/^$/,$p' | sed 1d

echo
echo "### push"
if [ -z "${UPDATE_OPEN_PRS+set}" ]; then
  OPEN=$(GH_HOST=github.int.exe.xyz gh api '/repos/glencbz/diffy/pulls?state=open&per_page=100' --jq '.[].head.ref' | tr '\n' ' ') ||
    { echo "update: cannot read open PRs; pushing nothing"; OPEN=""; }
fi
for b in $OPEN; do
  [ "$(q "present(bookmarks(exact:\"$b\"))" '"x"')" = x ] || continue
  if [ -n "$(q "conflicts() & (trunk()..bookmarks(exact:\"$b\"))" '"x"')" ]; then
    echo "  held     $b: conflicted, resolve it and rerun"
  elif [ "$(q "bookmarks(exact:\"$b\")" commit_id)" = "$(q "present(remote_bookmarks(exact:\"$b\", remote=exact:\"origin\"))" commit_id)" ]; then
    echo "  current  $b"
  elif "${J[@]}" git push --remote origin --bookmark "exact:$b" >/dev/null 2>&1; then
    echo "  pushed   $b: refresh its preview"
  else
    echo "  failed   $b: jj git push --bookmark $b says why"
  fi
done

echo
echo "### left to do"
q "conflicts() & trunk()..($WIP)" 'change_id.short() ++ "  conflict  " ++ local_bookmarks.map(|b| b.name()).join(" ") ++ "  " ++ description.first_line() ++ "\n"'
# A branch squash-merged on GitHub rebases to changes with nothing left in them.
q "(empty() ~ description(exact:\"\")) & trunk()..($WIP)" 'change_id.short() ++ "  emptied   " ++ local_bookmarks.map(|b| b.name()).join(" ") ++ "  " ++ description.first_line() ++ "\n"'
