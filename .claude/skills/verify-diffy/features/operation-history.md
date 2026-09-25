# Operation history

Each picker column has its own `operation` dropdown listing the repo's jj
operations, newest first. Choosing one re-reads that column's log at that point
in the repo's history, so a user can compare a commit as it is now against the
same commit as it was.

## Sub-features

- `op-list` fills each picker from `/api/operations`, labelled
  `<opId8>  <description or args>  <yyyy-mm-dd hh:mm:ss>`.
- `op-latest` offers `latest (current)` as the default, which sends no `op`
  parameter.
- `op-travel` reloads that column's commit log at the chosen operation.
- `op-per-side` leaves the other column's operation and selection untouched.
- `op-clears-selection` drops the column's selected commits when its operation
  changes, so the comparison pane falls back to whatever the other column holds.
- `op-loading` shows `Loading operations...` until `/api/operations` answers,
  and the error text in red when it fails.

## How to get to it (user POV)

- Open `$URL` and use the `operation` dropdown at the top of either column.
- Choose `latest (current)` to return that column to the present.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK` and prints an `early op` id.
- `OP=$(cat /tmp/diffy-verify/default/early-op)` is the full id of the
  operation right after the fixture's first commit.

- **Read the picker.** `browser_navigate` to `$URL`, `browser_wait_for` with
  `text: "fixture: merge the two topics"`, then `browser_snapshot`. Each
  `combobox "operation"` lists `latest (current)` as `[selected]`, then one
  option per operation down to `00000000`. The option whose label starts with
  the first eight characters of `$OP` is the travel target.
- **Travel one column.** `browser_select_option` with
  `target: '.pane:has(h2:text-is("before")) select'` and `values: ["$OP"]`, the
  full id, because the option's value is the full id while its label is the
  short one. Then `browser_wait_for` with `text: "fixture: add the notes file"`.
- **Confirm the log shrank.** The `before` column now lists three rows: an
  undescribed working copy carrying `@` and `(empty)`, `fixture: add the notes
  file`, and the root. Nothing about sidecars, the extension or the merge is
  present.
- **Confirm the other column held.** The `after` column still reads
  `latest (current)`, still lists eight rows, and still holds whatever was
  selected in it.
- **Confirm the selection cleared.** Select a row in `before` before
  travelling; afterwards no row in that column is selected and the comparison
  pane shows only the `after` column's commits.
- **Confirm against the API.** `curl -fsS "$URL/api/log?op=$OP"` returns the
  same three entries in the same order.
- **Return to the present.** `browser_select_option` with
  `values: ["latest (current)"]`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`.
- **Proof.** A snapshot and an unnamed screenshot at the travelled state,
  showing one column's selected option and its shortened log beside the other
  column's untouched one.

## Gotchas

- Both columns own a `select`, so a bare `target: "select"` is ambiguous. Scope
  it to a column, or pass the `ref` from the snapshot.
- Selecting by label fails. Pass the full 128-character operation id as the
  value.
- A change id outlives an operation, so the same change id can name a different
  commit id on each side. The working copy at the early operation and
  `fixture: extend the notes file` at `latest (current)` are one change.
- `browser_wait_for` with `textGone` succeeds immediately after a travel,
  because the list is replaced by `Loading commits...` before the new rows
  arrive. Wait for text that must be present instead.
- Operation ids are regenerated on every fixture build. Read `$OP` at drive
  time.
- Operation labels fall back to the command line when jj records no
  description, so two operations can read alike. Disambiguate by id, never by
  label text.
