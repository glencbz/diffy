# diffy verification map

This directory is the maintained source for verifying diffy's user-facing
behavior. Read this index before driving the app, then follow the matching
feature file.

## Baseline preconditions

- Start an instance with `.claude/skills/verify-diffy/harness/verify.sh start`
  and keep its URL in `$URL`.
- The instance serves the fixture jj repo under `/tmp/diffy-verify/default`, not
  the repo you are working in.
- `verify.sh doctor` reports `OK` and a pid, URL and fixture path.
- The `playwright` MCP server from the repo's `.mcp.json` is connected.
- Never drive an instance this run did not start, and never drive port 3000.

## The screen

The top navigation holds four tabs: `Local reviews`, `Operations`,
`Pull requests` and `Settings`. `Operations`, at `/`, is the landing screen: a
`commits` graph with an `operation` dropdown, beside a pane that diffs what the
graph has ticked, one section per commit. The `interdiff` toggle splits the
graph into `before` and `after`, each with its own operation, and the pane then
diffs one against the other. Below 1000 pixels wide the panes show one at a
time. `Local reviews`, at `/reviews`, reads the series registered from the
graph or by an agent. `Settings` holds display preferences. `Pull requests`
the harness cannot reach; see the scope note at the end.

Review state (marks, viewed files, comments, local reviews) lives in the
server's store, `review.sqlite` in the run directory, not in the browser. It
outlives a fresh browser and dies with `verify.sh stop`.

## Driving conventions

- Start every recipe from a fresh `browser_navigate` to `$URL` unless the recipe
  says otherwise.
- Wait for content before asserting. The first paint is `Loading commits...`,
  `Loading operations...` and, once a commit is ticked, `Loading diff...`.
- Prefer accessible names over CSS position. A commit row is a button whose name
  is the whole `jj log` line: change id, author email, committer timestamp, any
  bookmarks or tags, commit id, markers such as `@` and `(empty)`, then the
  description. Match on the description, not the whole string.
- With the interdiff open both graphs hold the same rows and both own an
  `operation` combobox, so an unscoped row name or picker is
  ambiguous. Scope with `.pane:has(h2:text-is("before"))`, or click the `ref`
  the snapshot gives for the column you mean. The lone graph is headed
  `commits`, not `after`.
- Read change ids, commit ids and operation ids from the page or from `/api/*` at
  drive time. They are regenerated every time the fixture is built.
- A recipe that writes review state or changes the fixture leaves it changed
  for the next one. Start from `verify.sh stop` and `start` when a recipe
  needs a clean store or the fixture's own history.
- Treat commands as literal, including quoted fixture descriptions.

## Proof and skip reporting

- Capture the action and the state it produced, not only the final screen.
- UI proof is an ARIA snapshot plus an unnamed screenshot, the form that hands
  back the image rather than a link to one.
- Confirm what the UI shows against the same data from `/api/*`.
- Record the feature id and the entry point used with every artifact.
- Report an unreachable path with the attempted call and the unmet
  precondition. Do not report one entry point as proof for another.

## Features

- [Commit graph](./commit-log.md) covers the Operations graph's rows, lanes
  and merge marker, and ticking commits.
- [Comparison pane](./comparison.md) covers the paired sections, each file's
  fold, diff view switch, context gaps and colouring, and the empty states.
- [File navigation](./file-navigation.md) covers the `Files changed` summary,
  the file navigator and its filterable list.
- [Operation history](./operation-history.md) covers travelling a graph to a
  past operation, the `newer` notice, and the interdiff's second graph.
- [Review tracking](./review-tracking.md) covers marking a section seen,
  viewed files, and the comments written on it, all kept in the server's
  store.
- [Local reviews](./local-reviews.md) covers registering a series from the
  graph or the API, the list, and reading a review version by version.
- [Settings](./settings.md) covers the top tabs and the display preferences.
- [Narrow layout](./narrow-layout.md) covers the one-pane-at-a-time phone
  layout.
- [jj-backed API](./jj-api.md) covers the endpoints behind those screens and
  the error path they share.

## Out of scope: pull requests

The `Pull requests` tab reads a real GitHub repository. Under the harness it
renders `Error: this repository has no origin remote`, because the fixture has
no remote, and even with one the harness passes the server no `GH_HOST`.
Nothing here covers those screens, and clicking the tab proves only that the
error path renders. To exercise them, start a server by hand with
`GH_HOST` exported and drive it as a separate run.
