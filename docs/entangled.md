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
