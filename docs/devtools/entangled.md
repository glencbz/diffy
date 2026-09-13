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

## Docs site

Since the whole project is literate, `docs/` doubles as a website. We render it
with MkDocs (Entangled's own recommended setup) plus the Material theme. The
config lives in `mkdocs.yml` at the repo root, kept out of the docs for the
same reason `entangled.toml` is.

The `mkdocs-entangled-plugin` is what makes rendered code blocks readable: it
turns the `#| id:` / `#| file:` attribute lines into block titles instead of
leaving them in the listing. Its latest release predates the `entangled-cli`
2.4.2 config-reading change and no newer one exists, so a patched copy is
vendored under `vendor/mkdocs-entangled-plugin/` and pulled in as an editable
path dependency. See that directory's `README.md` for the one-line diff and
the drop-the-vendor conditions.

```just
#| id: just-docs
# Serve the docs site with live reload
@docs:
  uv run mkdocs serve --dev-addr 0.0.0.0:8000

# Build the static docs site into ./site
@docs-build:
  uv run mkdocs build --strict
```
