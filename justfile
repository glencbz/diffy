# ~/~ begin <<docs/just.md#justfile>>[init]

_default:
  just --list

@install:
  # ~/~ begin <<docs/python.md#just-uv-install>>[init]
  uv sync
  # ~/~ end
  # ~/~ begin <<docs/bun.md#just-bun-install>>[init]
  bun install
  # ~/~ end

# ~/~ begin <<docs/entangled.md#just-entangled>>[init]
# Sync from docs to code or vice-versa
@en-sync:
  uv run entangled sync

# Tangle from docs to code
@en-tangle *args:
  uv run entangled tangle {{args}}
# ~/~ end

# ~/~ begin <<docs/bun.md#just-bun>>[init]
# Run the app
@run:
  bun run src/index.ts
# ~/~ end
# ~/~ end
