---
name: verify-diffy
description: Drive diffy's web UI (React commit graphs, comparison pane, operation pickers served by Bun) through Playwright MCP against a throwaway jj fixture repo, and capture screenshots and ARIA snapshots as proof. Use when asked to verify, demo, or screenshot diffy's UI, to reproduce a UI bug, or to prove a frontend or /api change works in the real app rather than only in bun test.
---

# Verify diffy

diffy is a jj-backed code review UI: a Bun server answers the page's `/api/*`
calls by shelling out to `jj` in its own working directory, and serves a React
single page that renders a commit graph twice, `before` and `after`, and the
diff between the commit picked on each side, with a settings tab and a
one-pane layout for narrow screens. The same app also reviews GitHub pull
requests, a mode this harness does not reach; see the scope note in
`features/README.md`.

A verification run starts its own instance on an ephemeral port, pointed at a
throwaway jj repo with known commits. It never touches port 3000, the repo you
are working in, or anyone else's session.

Read [`features/README.md`](features/README.md) before driving anything. It is
the maintained list of user-facing behavior and the recipe for each feature.

## Launch

```sh
.claude/skills/verify-diffy/harness/verify.sh start   # prints http://127.0.0.1:<port>
```

The command is idempotent: it prints the existing URL if an instance is already
up. It is ready when it prints the URL, which it only does after the server logs
`Listening on`. Capture it once per run:

```sh
URL=$(.claude/skills/verify-diffy/harness/verify.sh url)
```

The fixture repo is built on first start under `/tmp/diffy-verify/default`
(override the whole path with `DIFFY_VERIFY_RUN_DIR`, or just the last segment
with `DIFFY_VERIFY_RUN_ID` to run two instances side by side). Its history is
fixed, so every run can assert on the same commit descriptions:

```
fixture: edit the long file and the script         edits long.txt at both ends,
                                                   edits greet.js, deletes bun.lock
fixture: add a long file, a lock file and a script adds long.txt (60 lines),
                                                   bun.lock and greet.js; off the root
fixture: an empty change                           working copy, no file changes
fixture: merge the two topics                      merge commit, two parents, no file changes
fixture: add a sidecar file                        adds sidecar.txt
fixture: extend the notes file                     modifies notes.txt, one added line
fixture: add the notes file                        adds notes.txt
(no description)                                   jj's root commit
```

That is the order `/api/log` and the page list them. The two long-file commits
are a second topic off the root, apart from the merge.

Change ids are random per fixture build, so read them from the page or from
`/api/log` — never hardcode one.

## Doctor

```sh
.claude/skills/verify-diffy/harness/verify.sh doctor
```

It confirms the recorded pid is alive, that its URL answers `/api/log`, and that
the body is the fixture's history rather than some other repo, then prints the
pid, URL, fixture path and the fixture's early operation id. Run it first
whenever a drive behaves unexpectedly; a failure means the instance is not worth
driving.

If the browser fails to start, check that Playwright's chromium is present:

```sh
ls ~/.cache/ms-playwright            # expect a chromium-* directory
bunx playwright install chromium     # if it is missing
```

## Drive

Use the `playwright` MCP server configured in `.mcp.json` at the repo root. It
runs headless with an in-memory profile and writes its output to
`.claude/verify-artifacts/`. A session that has not approved the project MCP
config will not have the `browser_*` tools; approve it and restart rather than
reaching for a different browser.

Point it at the URL from `verify.sh url`, then work from an ARIA snapshot:

- `browser_navigate` with the run's `$URL`.
- `browser_wait_for` with `text`, because the page renders `Loading commits...`
  and `Loading operations...` first, so every drive must wait for real content
  before asserting.
- `browser_snapshot` for the ARIA tree, or read the `.yml` file that every tool
  result links.
- `browser_click` with `target` as a snapshot `ref` or a selector.
- `browser_select_option` with the full operation id as the value, scoped to
  one column: each of `before` and `after` owns an `operation` combobox.

Stable handles in this UI:

| What | Handle |
| --- | --- |
| One column | `.pane:has(h2:text-is("before"))`, or `"after"` |
| A commit row | `button` whose name is the whole `jj log` line, so match a fragment: `button:has-text("fixture: extend the notes file")` |
| The root commit row | `button` named `zzzzzzzz 1970-01-01 00:00:00 00000000 (empty) (no description)` |
| A merge row | commit row whose lane circle is hollow; confirm merges through `parents` in `/api/log` |
| An operation picker | `combobox "operation"` inside a column, options labelled `<opId8>  <what>  <when>` |
| A comparison section | `section` holding a `.comparison-header` and its files |
| A diff file header | a fold `button` named `added sidecar.txt`, `[expanded]` when open |
| A file's diff view | `group "Diff view"` holding `button "structural"` and `button "lines"` |
| A context gap | `button` named `⋯ show N unchanged lines` |
| A commentable line | `.diff-line--interactive`, a `button` named `<afterLine> <text>` |
| File summary | `region "Files changed"`, rows named `<status letter> <path> <counts>` |
| File navigator | `button "Previous file"`, `"Show changed files"`, `"Next file"`; `dialog "Changed files"` |
| Top tabs | `nav button:text-is("Settings")`, or `"Local history"`, `"Pull requests"` |
| Narrow pane tabs | `button "before <what it holds>"`, `"after ..."`, `"diff"`, below 1000px |
| Empty states | `Select commits on either side to compare them.`, `No changes in this commit.`, `Both commits make the same change.` |

The API is a legitimate second view for proving a side effect, never a substitute
for driving the UI:

```sh
curl -fsS "$URL/api/log"
curl -fsS "$URL/api/interdiff?from=<commitId>&to=<commitId>"
curl -fsS "$URL/api/log?op=$(cat /tmp/diffy-verify/default/early-op)"
```

## Evidence

Proof artifacts go to `.claude/verify-artifacts/` in the repo, which is
gitignored and survives cleanup.

Take a screenshot with no `filename`. That is the only form whose result carries
the image, so it is the only form you can look at:

```json
{"fullPage": true}
```

The server names the file under the `--output-dir` in `.mcp.json`, which is that
same artifacts directory, and hands back both the path and the pixels. Passing a
`filename` suppresses the image and returns a link alone, so a run that names
every shot is a run that never saw one. Name a shot only when a later step needs
to find it again, and `Read` the path afterwards to look at it.

Every path in a tool result, screenshot or ARIA snapshot alike, is relative to
the directory the session started in, because that is where the MCP server runs.
It is not your jj workspace. Resolve one against the session directory before
reading it, or the read fails on a file that is sitting there.

A human sees none of this: the images are on the VM. When someone wants to
look, serve the artifacts directory on a port from 3000 to 9999 and hand over
`https://<vm>.exe.xyz:<port>/`, which the exe.dev proxy already forwards.

Standards for a proof of this app:

- Drive the real page. Setting React state through `browser_evaluate`, or
  calling `/api/*` alone, proves nothing about the UI.
- Capture the action and its result: the snapshot after the click that shows
  both the selected row and the diff pane it produced, not just a final screen.
- Check the side effect in a second view. A section shown in the UI should
  match `/api/interdiff` asked for the same full commit ids.
- Do not mock `jj`. The fixture repo is the isolation boundary; the server runs
  the real CLI against it.
- Keep the ARIA snapshot alongside the screenshot. Text assertions belong to the
  snapshot; the screenshot proves layout, lanes and colour.

## Cleanup

```sh
.claude/skills/verify-diffy/harness/verify.sh stop
```

It kills the pid it recorded at start — never by process name, which would take
out a developer's own `just run` — and removes the fixture and run directory.
Artifacts under `.claude/verify-artifacts/` are left in place; confirm they are
still there after stopping. Run `stop` after a failed attempt too, so a broken
run does not strand a server.

## Helpers

`harness/verify.sh` is the only entry point; `{start|doctor|stop|url}` is its
full surface. It launches `harness/serve.ts`, which imports the real `routes`
from `src/server.ts` and binds port 0, so the kernel picks a port no other
session holds. It runs the server inside the pinned `nix#runtime` shell, the
same one `just run` uses, because difftastic is only on the `PATH` there; a
server without it disables every file's `structural` view. Running
`src/server.ts` itself takes `$PORT` or falls back to 3000, which is the port a
developer's own `just run` is already on.

Both files are verification scaffolding under `.claude/`, deliberately outside
Entangled's `docs/**/*.md` sources. Edit them directly; do not tangle them.
