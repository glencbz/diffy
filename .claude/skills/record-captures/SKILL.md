---
name: record-captures
description: Record screenshots and clips of diffy's own UI at a commit and at its parent, and attach them to a review with the record_captures tool, so the reader sees what a change does beside its code. Use after writing a version's component map, for every commit that changes what the review screen or any other screen shows.
---

# Recording captures of diffy

`record_captures` (diffy's MCP tools) drives a browser through a recipe on
two running copies of the app, one at the commit and one at its parent,
measures the element each component draws, and attaches the result. Serving
those two copies is your job; this skill is how to do it for diffy itself.
The tool's own doc is `docs/architecture/backend/recording.md`.

Write the version's component map first. A capture names its components by
their ids, and the tool refuses one the map lacks.

## 1. A workspace at each side

```sh
C=<change id of the commit>
jj workspace add --name rec-after  -r "$C"  /tmp/rec-after
jj workspace add --name rec-before -r "$C-" /tmp/rec-before
(cd /tmp/rec-after && bun install) && (cd /tmp/rec-before && bun install)
```

Run `bun install` in each; a symlinked `node_modules` gets snapshotted by jj.

## 2. Serve each side on something worth showing

Each side is a diffy server pointed at a repository with a review in it.
Give each side its own copy of the data directory: a server older than the
review document's newest field drops that field the next time it writes,
and the two sides must not share a store with the server the reader uses.

```sh
cp -r <a data dir with a review in it> /tmp/rec-data-after
cp -r <the same> /tmp/rec-data-before
serve() {  # workspace, data dir, port
  (cd <the repository the review is in> && XDG_DATA_HOME=$2 NODE_ENV=production \
    nix --extra-experimental-features 'nix-command flakes' develop path:$1/nix#runtime \
    -c bun run $1/src/cli.ts --port $3 > /tmp/rec-$3.log 2>&1 &)
}
serve /tmp/rec-after  /tmp/rec-data-after  5201
serve /tmp/rec-before /tmp/rec-data-before 5202
```

The pantry demo under `/tmp/artifact-demo` (repo `/tmp/artifact-demo/repo`,
review `theme`, data with captures `/tmp/panels-check/data`) is a ready
subject for the review screen when it exists on this VM. Otherwise register a
review of a few commits of diffy itself in a fresh data directory through
that side's `/mcp`.

Set the same layout on both sides, so the pictures compare:

```sh
for p in 5201 5202; do
  curl -s -X PUT localhost:$p/api/layouts -d '{"current":"stacked","edited":{}}'
done
```

## 3. Record

Call `record_captures` with `after: http://localhost:5201`,
`before: http://localhost:5202`, and one recipe per capture:

- `path` is a URL path on the app, such as `/reviews/theme/commits/<id>?to=2`.
- Start `steps` with `{"do": "wait", "ms": 3000}`: the review screen loads
  its comparison after the page.
- `shows` names a selector per component. Use the classes the commit's code
  gives the element (`.panel-host--viewer`, `.viewer__frame`); `:has()` and
  `:nth-child()` work. A selector that matches nothing at the commit is
  refused, so check them in the commit's code, not the parent's.
- Set `clip: true` to record the steps as a video, and `from` on a show to
  the step after which the component is on screen, so its box appears then.
- Give each capture a `state` (`desktop`, `phone`, `dark`) and a different
  `viewport` for a phone (`412 × 860`).

A step that fails at the parent is fine, and expected for a commit that adds
the thing the recipe clicks: the capture has nothing at the parent, and the
answer says why. A step that fails at the commit fails the capture.

## 4. Clean up

Stop the two servers by port, never by name, since every workspace runs the
same command line:

```sh
for p in 5201 5202; do
  kill $(ss -ltnp | grep ":$p " | grep -o 'pid=[0-9]*' | cut -d= -f2)
done
jj workspace forget rec-after rec-before
```

## When it does not run

- `the browser made no clip; Playwright's ffmpeg ...`: run
  `bun node_modules/playwright-core/cli.js install ffmpeg`.
- No browser at all: diffy uses `$DIFFY_CHROMIUM`, else the newest Chromium
  under `~/.cache/ms-playwright`. Install one with the same CLI
  (`install chromium`), or point `DIFFY_CHROMIUM` at one.
