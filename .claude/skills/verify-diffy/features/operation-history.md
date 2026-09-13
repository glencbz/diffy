# Operation history

A picker above the commit log lists the repo's jj operations, newest first.
Choosing one re-reads the log and any diff at that point in the repo's history,
so a user can see what the repo looked like before an operation.

## Sub-features

- `op-list` fills the picker from `/api/operations`, labelled
  `<opId8>  <description or args>  <yyyy-mm-dd hh:mm:ss>`.
- `op-latest` offers `latest (current)` as the default, which sends no `op`
  parameter.
- `op-travel` reloads the commit log at the chosen operation.
- `op-clears-selection` drops the selected change when the operation changes, so
  the diff pane returns to `Select a commit to see its diff.`
- `op-diff` diffs a change as it was at the chosen operation.

## How to get to it (user POV)

- Open `$URL` and use the `operation` dropdown at the top of the left pane.
- Choose `latest (current)` to return to the present.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK` and prints an `early op` id.
- `OP=$(cat /tmp/diffy-verify/default/early-op)` — the full id of the operation
  right after the fixture's first commit.

- **Read the picker.** `browser_navigate` to `$URL`, `browser_wait_for` with
  `text: "fixture: merge the two topics"`, then `browser_snapshot`. The
  `combobox "operation"` lists `latest (current)` as `[selected]`, then one
  option per operation down to `00000000`. The option whose label starts with
  the first eight characters of `$OP` is the travel target.
- **Travel.** `browser_select_option` with `target: "select"` and
  `values: ["$OP"]` — the full id, because the option's value is the full id
  while its label is the short one. Then `browser_wait_for` with
  `text: "fixture: add the notes file"`.
- **Confirm the log shrank.** The snapshot now lists three rows: an undescribed
  working copy, `fixture: add the notes file`, and the root. Nothing about
  sidecars, the extension or the merge is present.
- **Confirm the selection cleared.** The right pane reads
  `Select a commit to see its diff.` even if a change was selected first.
- **Confirm against the API.** `curl -fsS "$URL/api/log?op=$OP"` returns the same
  three entries in the same order.
- **Return to the present.** `browser_select_option` with
  `values: ["latest (current)"]`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`.
- **Proof.** A snapshot and an absolute-path screenshot at the travelled state,
  showing the selected option and the shortened log together.

## Gotchas

- Selecting by label fails. Pass the full 128-character operation id as the
  value.
- `browser_wait_for` with `textGone` succeeds immediately after a travel,
  because the list is replaced by `Loading commits...` before the new rows
  arrive. Wait for text that must be present instead.
- Operation ids are regenerated on every fixture build. Read `$OP` at drive time.
- The picker lists up to 200 operations. A fixture rebuilt many times in one run
  directory does not exist — `verify.sh stop` removes it — so the list stays
  short.
- Operation labels fall back to the command line when jj records no description,
  so two operations can read alike. Disambiguate by id, never by label text.
