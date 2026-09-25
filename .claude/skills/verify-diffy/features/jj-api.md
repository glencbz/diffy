# jj-backed API

The Bun server answers the page's jj-backed calls. Each shells out to `jj` in
the server's working directory and returns JSON; a revset or operation jj
refuses becomes a 400 carrying jj's own message.

## Sub-features

- `api-log` returns `GET /api/log` as an array of the fields `jj log` prints for
  a commit, the `JjLogEntry` interface in `src/backend/commit/jj.ts`, and
  accepts `?op=<operationId>`.
- `api-operations` returns `GET /api/operations` as an array of
  `{id, description, time, args}`, newest first, capped at 200.
- `api-interdiff` returns `GET /api/interdiff?from=<commitId>&to=<commitId>`,
  both repeatable, as `{rows}`: one row per aligned pair of the two series,
  carrying the `from` and `to` log entries, either of which may be `null`, and
  the `files` between them.
- `api-diff` returns `GET /api/diff?rev=<revset>` as `{revision, files}`, and
  defaults to `@` when `rev` is absent. The page itself no longer calls it; the
  comparison pane asks `/api/interdiff` even for a single commit.
- `api-file` is the shape of each file both diff routes return: a status, path,
  `binary` flag and `--git` patch, the `oldBlob` and `newBlob` ids of its two
  sides, and `structural`, difftastic's reading of the same change. That is
  `{kind: "structural", language, hunks}`, or `{kind: "unavailable", reason}`
  for an added, deleted or binary file, or when difftastic is missing.
- `api-source` returns `GET /api/source?blob=<blobId>&path=<path>` as
  `{language, lines}`, the blob's text split into highlighted tokens. The page
  asks it for both sides of every text file it draws.
- `api-error` turns a jj failure into HTTP 400 with `{"error": "..."}` for every
  jj-backed route.

## How to get to it (user POV)

- The page calls `/api/log`, `/api/operations`, `/api/interdiff` and
  `/api/source`; a user
  reaches them only through the UI.
- A developer or script can call them directly with `curl` against `$URL`.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`; it already proved `/api/log` answers.
- `$URL` is this run's instance.

- **Log shape.** `curl -fsS "$URL/api/log"` returns eight entries; the first is
  `fixture: edit the long file and the script` and the last has an empty `parents` array.
- **Merge parents.** The entry described `fixture: merge the two topics` has two
  `parents`; every other non-root entry has one.
- **Operations.** `curl -fsS "$URL/api/operations"` returns entries whose `id` is
  a 128-character hex string and whose `time` is ISO 8601.
- **Diff default.** `curl -fsS "$URL/api/diff"` returns `revision: "@"` and an
  empty `files` array, matching the fixture's empty working copy.
- **Interdiff of one commit.** `curl -fsS "$URL/api/interdiff?to=<commitId>"`
  for `fixture: add a sidecar file` returns one row whose `from` is `null` and
  whose `files` hold the `added` `sidecar.txt`.
- **Interdiff of a pair.** Passing `from` and `to` for two commits returns one
  row carrying both log entries and the patch between the two versions.
- **Diff content.** `curl -fsS "$URL/api/diff?rev=<changeId>"` for the change
  described `fixture: extend the notes file` returns one `modified` file
  `notes.txt` whose patch contains `+line two`.
- **Structural field.** For `fixture: edit the long file and the script`,
  `/api/diff?rev=<changeId>` returns `greet.js` with `structural.kind` of
  `structural` and `language` `JavaScript`, and the deleted `bun.lock` with
  `unavailable` and the reason `deleted file`.
- **Source.** Take `greet.js`'s `newBlob` from the same answer and run
  `curl -fsS "$URL/api/source?blob=<newBlob>&path=greet.js"`. It returns
  `language: "js"` and a first line starting with a `keyword` token `function`.
  An empty `blob` is a 400; a well-formed id the store lacks, such as
  `deadbeef`, is a 404.
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
- `/api/interdiff` wants full commit ids. A short id matches no commit and its
  row is silently dropped, so the answer is `{"rows":[]}` rather than an error.
  Asking with neither `from` nor `to` is the one 400 it raises itself:
  `{"error":"interdiff needs at least one commit"}`.
- An unparseable jj response is a 500, not a 400; only `JjError` maps to 400.
  Do not report a 500 as the error path working.
- `structural` reading `difftastic is not installed` means the server was not
  started through `verify.sh`, which runs it inside the pinned `nix` runtime.
- The `/api/github/*` routes belong to the pull request screens and are out of
  scope here. They map failures differently: a missing pull request is a 404,
  a `gh` or `git` failure a 502, and a malformed parameter a 400.
- The UI's own error rendering (red `Message` text) is not reachable with a
  healthy fixture. Prove the 400 at the API and note the UI path as unproven
  rather than faking a failure with `browser_evaluate`.
