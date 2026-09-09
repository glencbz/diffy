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
that commit. `pyproject.toml` and this `README.md` are local additions so
the package can be installed as an editable path dependency.
