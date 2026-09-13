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

## Driving conventions

- Start every recipe from a fresh `browser_navigate` to `$URL` unless the recipe
  says otherwise.
- Wait for content before asserting. The first paint is `Loading commits...` and
  `Loading operations...`.
- Prefer accessible names over CSS position. Commit rows are buttons named
  `<changeId8> <description>`; the operation picker is the only `combobox`.
- Read change ids and operation ids from the page or from `/api/*` at drive
  time. They are regenerated every time the fixture is built.
- Treat commands as literal, including quoted fixture descriptions.

## Proof and skip reporting

- Capture the action and the state it produced, not only the final screen.
- UI proof is an ARIA snapshot plus a screenshot at an absolute path under
  `.claude/verify-artifacts/`.
- Confirm what the UI shows against the same data from `/api/*`.
- Record the feature id and the entry point used with every artifact.
- Report an unreachable path with the attempted call and the unmet
  precondition. Do not report one entry point as proof for another.

## Features

- [Commit log](./commit-log.md) covers the graph rows, lanes, merge marker and
  selection.
- [Revision diff](./revision-diff.md) covers the diff pane, file statuses,
  patch colouring and the empty states.
- [Operation history](./operation-history.md) covers viewing the log and diff at
  a past repo operation.
- [jj-backed API](./jj-api.md) covers the three endpoints the page reads and the
  single error path they share.
