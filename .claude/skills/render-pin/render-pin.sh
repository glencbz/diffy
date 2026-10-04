#!/usr/bin/env bash
# Renders a fixture's views at two revisions and compares the markup.
# usage: render-pin.sh <fixture.tsx> [before-rev] [after-rev]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <fixture.tsx> [before-rev (default trunk())] [after-rev (default: this working copy)]" >&2
  exit 2
fi

here=$(cd "$(dirname "$0")" && pwd)
fixture=$(realpath "$1")
before_rev=${2:-'trunk()'}
after_rev=${3:-}
repo=$(jj workspace root)
out=$(mktemp -d "${TMPDIR:-/tmp}/render-pin.XXXXXX")
made=()

cleanup() {
  for name in "${made[@]}"; do
    change=$(jj -R "$repo" log -r "$name@" --no-graph -T change_id 2>/dev/null || true)
    jj -R "$repo" workspace forget "$name" >/dev/null 2>&1 || true
    [[ -n $change ]] && jj -R "$repo" abandon "$change" >/dev/null 2>&1 || true
    rm -rf "$out/$name"
  done
}
trap cleanup EXIT

# Sets $checkout to a fresh jj workspace at the revision, with its own
# node_modules so its views load the React they were built against.
checkout_at() {
  local name="render-pin-$1-$$"
  checkout="$out/$name"
  jj -R "$repo" --quiet workspace add --name "$name" -r "$2" "$checkout"
  made+=("$name")
  (cd "$checkout" && bun install --frozen-lockfile >/dev/null)
}

# The runner and fixture go under the checkout's node_modules, which jj
# ignores, so React resolves to that checkout's copy.
render() {
  local side=$1 root=$2 dir="$2/node_modules/.render-pin"
  mkdir -p "$dir"
  cp "$here/pin.ts" "$dir/pin.ts"
  cp "$fixture" "$dir/fixture.tsx"
  local status=0
  (cd "$root" && bun "$dir/pin.ts" "$side" "$root") >"$out/$side.html" || status=$?
  rm -rf "$dir"
  if [[ $status -ne 0 ]]; then
    echo "the fixture failed on the $side side" >&2
    exit "$status"
  fi
}

checkout_at before "$before_rev"
render before "$checkout"

if [[ -n $after_rev ]]; then
  checkout_at after "$after_rev"
  render after "$checkout"
else
  render after "$repo"
fi

cases=$(grep -c '^## ' "$out/before.html" || true)
if cmp -s "$out/before.html" "$out/after.html"; then
  echo "IDENTICAL: $cases cases, $(wc -c <"$out/after.html") bytes ($out)"
else
  echo "DIFFERENT: $cases cases before, $(grep -c '^## ' "$out/after.html" || true) after ($out)"
  diff -u <(sed 's/></>\n</g' "$out/before.html") <(sed 's/></>\n</g' "$out/after.html") | head -60
  exit 1
fi
