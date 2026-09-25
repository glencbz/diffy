# ~/~ begin <<docs/devtools/just.md#justfile>>[init]

_default:
  just --list

@install:
  # ~/~ begin <<docs/tech/python.md#just-uv-install>>[init]
  uv sync
  # ~/~ end
  # ~/~ begin <<docs/tech/bun.md#just-bun-install>>[init]
  bun install
  # ~/~ end

# ~/~ begin <<docs/devtools/nix.md#just-nix>>[init]
# Run a command with diffy's runtime dependencies on PATH
nix_runtime := "nix --extra-experimental-features 'nix-command flakes' develop path:" + justfile_directory() / "nix#runtime -c"
# ~/~ end

# ~/~ begin <<docs/devtools/entangled.md#just-entangled>>[init]
# Sync from docs to code or vice-versa
@en-sync:
  uv run entangled sync

# Tangle from docs to code
@en-tangle *args:
  uv run entangled tangle {{args}}
# ~/~ end

# ~/~ begin <<docs/devtools/entangled.md#just-docs>>[init]
# Serve the docs site with live reload
@docs port="8000":
  uv run mkdocs serve --dev-addr 0.0.0.0:{{port}}

# Build the static docs site into ./site
@docs-build:
  uv run mkdocs build --strict
# ~/~ end

# ~/~ begin <<docs/architecture/backend/server.md#just-bun>>[init]
# Run the app
@run port="3000":
  PORT={{port}} {{nix_runtime}} bun run src/server.ts

# ~/~ end

# ~/~ begin <<docs/devtools/serving.md#just-serve>>[init]

serve_state := "/tmp/diffy-serve/" + file_stem(justfile_directory())

# Serve this workspace's app and docs detached; re-run to refresh them
serve:
  #!/usr/bin/env bash
  set -euo pipefail
  mkdir -p "{{serve_state}}"
  if [ ! -f "{{serve_state}}/ports" ]; then
    printf 'app=%s\ndocs=%s\n' "$(just _free-port 3000)" "$(just _free-port 8000)" \
      > "{{serve_state}}/ports"
  fi
  source "{{serve_state}}/ports"
  just serve-stop
  for name in app docs; do
    if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then
      echo "port ${!name} is held by something this workspace did not start" >&2
      exit 1
    fi
  done
  just _spawn "{{serve_state}}/app" env NODE_ENV=production just run "$app"
  just _spawn "{{serve_state}}/docs" just docs "$docs"
  for name in app docs; do
    for _ in $(seq 100); do
      if (exec 3<>/dev/tcp/127.0.0.1/"${!name}") 2>/dev/null; then continue 2; fi
      sleep 0.1
    done
    echo "$name never answered on ${!name}; see {{serve_state}}/$name.log" >&2
    exit 1
  done
  echo "app   https://$(hostname).exe.xyz:$app/"
  echo "docs  https://$(hostname).exe.xyz:$docs/"

# Stop this workspace's detached app and docs
serve-stop:
  #!/usr/bin/env bash
  set -euo pipefail
  for pidfile in "{{serve_state}}"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid="$(cat "$pidfile")"
    kill -- "-$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done
    rm -f "$pidfile"
  done
# ~/~ end

# ~/~ begin <<docs/devtools/serving.md#just-serve-helpers>>[init]

# Run a command detached, logging to <prefix>.log, recording <prefix>.pid
_spawn prefix +command:
  #!/usr/bin/env bash
  set -euo pipefail
  rm -f "{{prefix}}.pid"
  setsid bash -c 'echo $$ > "$0.pid"; exec "$@"' "{{prefix}}" {{command}} \
    > "{{prefix}}.log" 2>&1 < /dev/null &
  for _ in $(seq 40); do
    if [ -s "{{prefix}}.pid" ]; then break; fi
    sleep 0.05
  done

# Print the first port at or above the given one that nothing is listening on
_free-port start:
  #!/usr/bin/env bash
  port={{start}}
  while (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; do
    port=$((port + 1))
  done
  echo "$port"
# ~/~ end

# ~/~ begin <<docs/architecture/backend/server.md#just-bun-test>>[init]
# Run tests
@test:
  {{nix_runtime}} bun test
# ~/~ end

# ~/~ begin <<docs/architecture/backend/server.md#just-bun-typecheck>>[init]
# Typecheck without emitting
@typecheck:
  bunx tsc --noEmit
# ~/~ end

# ~/~ begin <<docs/architecture/backend/server.md#just-biome>>[init]
# Lint and check formatting/import order
@lint:
  bunx biome check .

# Lint and apply automatic fixes
@lint-fix:
  bunx biome check . --fix

# Format code in place
@format:
  bunx biome format --write .
# ~/~ end
# ~/~ end
