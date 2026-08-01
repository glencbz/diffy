_default:
  just list

@install:
  bun install
  uv sync

@tangle:
  uv run entangled tangle
