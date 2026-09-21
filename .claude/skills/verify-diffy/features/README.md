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

`Local history`, the landing tab, is three columns. `before` and `after` each
carry an `operation` dropdown over a commit log; the third diffs what the two
select, one section per aligned pair of commits. `Pull requests` is the other
tab, and the harness cannot reach it; see the scope note at the end.

## Driving conventions

- Start every recipe from a fresh `browser_navigate` to `$URL` unless the recipe
  says otherwise.
- Wait for content before asserting. The first paint is `Loading commits...`,
  `Loading operations...` and, once a commit is selected, `Loading diff...`.
- Prefer accessible names over CSS position. A commit row is a button whose name
  is the whole `jj log` line: change id, author email, committer timestamp, any
  bookmarks or tags, commit id, markers such as `@` and `(empty)`, then the
  description. Match on the description, not the whole string.
- Both columns hold the same rows and both own an `operation` combobox, so an
  unscoped name or `target: "select"` is ambiguous. Scope with
  `.pane:has(h2:text-is("before"))`, or click the `ref` the snapshot gives for
  the column you mean.
- Read change ids, commit ids and operation ids from the page or from `/api/*` at
  drive time. They are regenerated every time the fixture is built.
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

- [Commit log](./commit-log.md) covers the rows in each column, their lanes and
  merge marker, and selecting commits into a side.
- [Comparison pane](./comparison.md) covers the paired sections, file statuses,
  patch colouring and the empty states.
- [Operation history](./operation-history.md) covers travelling one column to a
  past repo operation.
- [Review tracking](./review-tracking.md) covers marking a section seen and the
  comments written on its lines.
- [jj-backed API](./jj-api.md) covers the jj-backed endpoints behind those
  screens and the error path they share.

## Out of scope: pull requests

The `Pull requests` tab reads a real GitHub repository. Under the harness it
renders `Error: To get started with GitHub CLI, please run: gh auth login`,
because the fixture has no remote and the harness passes the server no
`GH_HOST`. Nothing here covers those screens, and clicking the tab proves only
that the error path renders. To exercise them, start a server by hand with
`GH_HOST` exported and drive it as a separate run.
