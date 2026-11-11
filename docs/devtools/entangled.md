# Entangled

Entangled seems like a cool experiment to try. It's
a real pain in the ass to work with though, because
it's clearly pretty hacked together and with pretty
low maintenance, but nevertheless we try.

## Configuration


### `entangled.toml`

The primary config is via `entangled.toml`. I'm not
insane enough to try to move that into the docs for
now, but I'll do it eventually.

For the most part I haven't found anything that important to config. The most valuable pages to consult are:

* https://entangled.github.io/ for how to set up a language. 
* https://entangled.github.io/markup/ for
instructions on how to set up GitHub flavoured
markdown. Necessary to get syntax highlighting in
most editors.

### Just

For just, we primarily want sync. That picks the correct docs <-> code
direction most of the time.

```just
# | id: just-entangled
# Sync from docs to code or vice-versa
@en-sync:
  uv run entangled sync

# Tangle from docs to code
@en-tangle *args:
  uv run entangled tangle {{args}}
```

### Check

`check` is the one command that proves the tree is healthy. The tangle check
comes first, because a type error in a stale `src/` is noise. It tangles a
copy of the docs in a temporary directory and compares the result with the
committed outputs, so it never touches the working tree. Comparing the whole
`src/` directory, not only the files the docs name, also reports a file left
in `src/` that no doc produces any more. `nix/flake.nix` is the one file
compared from `nix/`, since the directory also holds a hand-written lock file.

```just
#| id: just-check
# Prove the tree is healthy: tangle, types, lint and tests all agree
check: check-tangle typecheck lint test

# Fail unless src/, the justfile and nix/flake.nix match a fresh tangle
check-tangle:
  #!/usr/bin/env bash
  set -euo pipefail
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cp -r docs entangled.toml "$tmp"
  # entangled exits 0 after logging an ERROR, so the log decides, not the status.
  log="$(cd "$tmp" && uv run --project "{{justfile_directory()}}" entangled tangle 2>&1)" || true
  if grep -q ERROR <<<"$log"; then
    echo "$log" >&2
    echo "entangled failed to tangle the docs (not drift in the tree)" >&2
    exit 1
  fi
  drift=0
  diff -rq "$tmp/src" src || drift=1
  for file in justfile nix/flake.nix; do
    diff -q "$tmp/$file" "$file" || drift=1
  done
  if [ "$drift" = 1 ]; then
    echo "tangled output differs from the tree; edit docs/ and run just en-tangle" >&2
    exit 1
  fi
```

## Docs site

`docs/` doubles as a website, rendered with MkDocs and the Material theme
(`mkdocs.yml`). `vendor/mkdocs-entangled-plugin/` turns the attribute lines into
block titles; its `README.md` says why it is vendored.

```just
#| id: just-docs
# Serve the docs site with live reload. Binds all interfaces so the exe.dev
# proxy can reach it; the port lets two workspaces serve at once.
@docs port="8000":
  uv run mkdocs serve --dev-addr 0.0.0.0:{{port}}

# Build the static docs site into ./site
@docs-build:
  uv run mkdocs build --strict
```
