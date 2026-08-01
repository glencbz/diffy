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

# ~/~ begin <<docs/devtools/entangled.md#just-entangled>>[init]
# Sync from docs to code or vice-versa
@en-sync:
  uv run entangled sync

# Tangle from docs to code
@en-tangle *args:
  uv run entangled tangle {{args}}
# ~/~ end

# ~/~ begin <<docs/tech/bun.md#just-bun>>[init]
# Run the app
@run:
  bun run src/index.ts

# ~/~ end

# ~/~ begin <<docs/tech/bun.md#just-bun-test>>[init]
# Run tests
@test:
  bun test
# ~/~ end

# ~/~ begin <<docs/tech/bun.md#just-bun-typecheck>>[init]
# Typecheck without emitting
@typecheck:
  bunx tsc --noEmit
# ~/~ end

# ~/~ begin <<docs/tech/bun.md#just-biome>>[init]
# Lint and check formatting/import order
@lint:
  bunx biome check .

# Format code in place
@format:
  bunx biome format --write .
# ~/~ end
# ~/~ end
