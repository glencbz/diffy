#!/usr/bin/env bash
# Bring every local branch up to date with origin's main: fetch, sweep what is
# dead, rebase every WIP bookmark onto trunk(), and rebuild the review chain.
# Dry run by default; --apply executes. Safe to rerun.
#
#   update.sh           fetch, then print the sweep plan and what would move
#   update.sh --apply   sweep, rebase, sync the review chain, report conflicts
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
HERE=$(cd "$(dirname "$0")" && pwd)
SKILLS=$(dirname "$HERE")
SWEEP=${UPDATE_SWEEP:-$SKILLS/clean-stale-work/sweep.sh}
REVIEW=${UPDATE_REVIEW:-$SKILLS/review-branch/review.sh}
BM=${REVIEW_BOOKMARK:-review}

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
stale=$(q "$ROOTS ~ children(trunk())" 'change_id.short() ++ "  " ++ local_bookmarks.join(" ") ++ "  " ++ description.first_line() ++ "\n"')
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
echo "### left to do"
q "conflicts() & trunk()..($WIP)" 'change_id.short() ++ "  conflict  " ++ local_bookmarks.join(" ") ++ "  " ++ description.first_line() ++ "\n"'
# A branch squash-merged on GitHub rebases to changes with nothing left in them.
q "(empty() ~ description(exact:\"\")) & trunk()..($WIP)" 'change_id.short() ++ "  emptied   " ++ local_bookmarks.join(" ") ++ "  " ++ description.first_line() ++ "\n"'
