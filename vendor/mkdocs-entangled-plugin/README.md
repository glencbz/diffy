# Vendored `mkdocs-entangled-plugin`

Upstream: <https://github.com/entangled/mkdocs-plugin>

Vendored at tag `v0.6.0`, commit
`1df90db9199cbfb6e37435d351c1b44c03cedce1` (2025-11-20), Apache-2.0.

Reproduce the upstream part of this tree:

```
git clone https://github.com/entangled/mkdocs-plugin
git -C mkdocs-plugin archive 1df90db9199cbfb6e37435d351c1b44c03cedce1 \
    mkdocs_entangled LICENSE | tar -x -C vendor/mkdocs-entangled-plugin/
```

Everything under `mkdocs_entangled/` and `LICENSE` is byte-for-byte from
that commit, except the one patch listed below. `pyproject.toml` and this
`README.md` are local additions so the package can be installed as an
editable path dependency.

## Why vendored

`mkdocs-entangled-plugin` 0.6.0 (2025-12-01) is the latest release and the
only one that targets the entangled-cli 2.x module layout this project
uses. It calls `read_config()` with no arguments, which works with
entangled-cli 2.4.0 and 2.4.1. entangled-cli 2.4.2 (2026-01-15) moved
config reading behind a virtual filesystem, changing the signature to
`read_config(fs)`, and nothing has been released since. This project pins
`entangled-cli>=2.4.3` for its watch-loop and missing-file fixes, so
downgrading to 2.4.1 to use the stock plugin was rejected. There is no
maintained alternative or fork.

Re-check on every entangled-cli bump: if a compatible plugin release
appears, delete this directory and depend on PyPI again.

## Local changes

- `mkdocs_entangled/on_page_markdown.py`: `read_config()` -> `read_config(fs)`,
  passing the `FileCache` the `Context` already builds.
