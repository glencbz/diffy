# jj-backed API

The Bun server exposes the three endpoints the page reads. Each shells out to
`jj` in the server's working directory and returns JSON; a revset or operation
jj refuses becomes a 400 carrying jj's own message.

## Sub-features

- `api-log` returns `GET /api/log` as an array of
  `{commitId, changeId, description, parents}`, and accepts `?op=<operationId>`.
- `api-operations` returns `GET /api/operations` as an array of
  `{id, description, time, args}`, newest first, capped at 200.
- `api-diff` returns `GET /api/diff?rev=<revset>` as `{revision, files}`, where
  each file carries a status, path, `binary` flag and `--git` patch, and
  defaults to `@` when `rev` is absent.
- `api-error` turns a jj failure into HTTP 400 with `{"error": "..."}` for every
  one of them.

## How to get to it (user POV)

- The page calls all three; a user reaches them only through the UI.
- A developer or script can call them directly with `curl` against `$URL`.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`; it already proved `/api/log` answers.
- `$URL` is this run's instance.

- **Log shape.** `curl -fsS "$URL/api/log"` returns six entries; the first is
  `fixture: an empty change` and the last has an empty `parents` array.
- **Merge parents.** The entry described `fixture: merge the two topics` has two
  `parents`; every other non-root entry has one.
- **Operations.** `curl -fsS "$URL/api/operations"` returns entries whose `id` is
  a 128-character hex string and whose `time` is ISO 8601.
- **Diff default.** `curl -fsS "$URL/api/diff"` returns `revision: "@"` and an
  empty `files` array, matching the fixture's empty working copy.
- **Diff content.** `curl -fsS "$URL/api/diff?rev=<changeId>"` for the change
  described `fixture: extend the notes file` returns one `modified` file
  `notes.txt` whose patch contains `+line two`.
- **Error path.** `curl -s -o /dev/null -w '%{http_code}' "$URL/api/diff?rev=nope-no-such"`
  prints `400`, and the body is
  `{"error":"Error: Revision \`nope-no-such\` doesn't exist"}`. The same holds
  for `/api/log?op=` with an unknown operation id.
- **In the browser.** `browser_network_requests` after a drive lists the page's
  own calls with their status codes; use it to prove the UI actually fetched
  rather than rendering stale state.
- **Proof.** Save the response bodies next to the UI artifacts in
  `.claude/verify-artifacts/`, named for the feature id they back.

## Gotchas

- The endpoints read the server's working directory, which is the fixture repo,
  never the repo you are editing. A `curl` that shows your own commits means the
  instance is not this run's.
- `description` keeps jj's trailing newline.
- An unparseable jj response is a 500, not a 400; only `JjError` maps to 400.
  Do not report a 500 as the error path working.
- The UI's own error rendering (red `Message` text) is not reachable with a
  healthy fixture. Prove the 400 at the API and note the UI path as unproven
  rather than faking a failure with `browser_evaluate`.
