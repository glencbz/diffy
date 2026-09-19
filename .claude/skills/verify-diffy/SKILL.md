---
name: verify-diffy
description: Drive diffy's web UI (React commit graph, diff pane, operation picker served by Bun) through Playwright MCP against a throwaway jj fixture repo, and capture screenshots and ARIA snapshots as proof. Use when asked to verify, demo, or screenshot diffy's UI, to reproduce a UI bug, or to prove a frontend or /api change works in the real app rather than only in bun test.
---

# Verify diffy

diffy is a jj-backed code review UI: a Bun server exposes `/api/log`,
`/api/operations` and `/api/diff` by shelling out to `jj` in its own working
directory, and serves a React single page that renders a commit graph on the
left and the selected revision's diff on the right.

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
fixture: an empty change        working copy, no file changes
fixture: merge the two topics   merge commit, two parents, no file changes
fixture: add a sidecar file     adds sidecar.txt
fixture: extend the notes file  modifies notes.txt, one added line
fixture: add the notes file     adds notes.txt
(no description)                jj's root commit
```

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
- `browser_wait_for` with `text` — the page renders `Loading commits...` and
  `Loading operations...` first, so every drive must wait for real content
  before asserting.
- `browser_snapshot` for the ARIA tree, or read the `.yml` file that every tool
  result links.
- `browser_click` with `target` as a snapshot `ref` or a selector.
- `browser_select_option` with `target: "select"` (the operation picker is the
  page's only combobox) and the full operation id as the value.

Stable handles in this UI:

| What | Handle |
| --- | --- |
| A commit row | `button` named `<changeId8> <description>`, e.g. `button:has-text("fixture: extend the notes file")` |
| The root commit row | `button` named `<changeId8> (no description)` |
| A merge row | commit row whose lane circle is hollow; confirm merges through `parents` in `/api/log` |
| The operation picker | `combobox "operation"`, options labelled `<opId8>  <what>  <when>` |
| A diff file header | text `modified notes.txt`, `added sidecar.txt` |
| Empty states | `Select a commit to see its diff.`, `No changes in this commit.` |

The API is a legitimate second view for proving a side effect, never a substitute
for driving the UI:

```sh
curl -fsS "$URL/api/log"
curl -fsS "$URL/api/diff?rev=<changeId>"
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

A human sees none of this: the images are on the VM. Serve the artifacts
directory and share the port with `ssh exe.dev share port <vm> <port>` when
someone wants to look.

Standards for a proof of this app:

- Drive the real page. Setting React state through `browser_evaluate`, or
  calling `/api/*` alone, proves nothing about the UI.
- Capture the action and its result: the snapshot after the click that shows
  both the selected row and the diff pane it produced, not just a final screen.
- Check the side effect in a second view. A diff shown in the UI should match
  `/api/diff?rev=<changeId>` for the same change id.
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
from `src/server.ts` and binds port 0, because `src/server.ts` hardcodes port
3000 when run directly and cannot host two instances.

Both files are verification scaffolding under `.claude/`, deliberately outside
Entangled's `docs/**/*.md` sources. Edit them directly; do not tangle them.
