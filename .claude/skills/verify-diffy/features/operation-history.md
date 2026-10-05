# Operation history

Each graph has its own `operation` picker listing the repo's jj operations,
newest first. A graph is always pinned to one operation, so nothing changes
under the reader; choosing another re-reads that graph's log at that point in
the repo's history. The `interdiff` toggle opens a `before` graph with a picker
of its own, so a commit as it is now can be compared against the same commit
as it was.

## Sub-features

- `op-list` fills each picker from `/api/operations`. The picker is an
  app-drawn `combobox "operation"`; clicking it opens a `listbox "operation"`
  whose options are named `<opId8> <description or args> <yyyy-mm-dd
  hh:mm:ss>`, with a `close the operation list` button beside it.
- `op-latest` offers `latest (current)` as the default: the newest operation
  when the graph loaded, not the live repo.
- `op-newer` shows a `newer: <opId8>` button on the after graph's row, named
  `Update to the newer operation ...`, once the repo gains an operation while
  that graph is on `latest (current)`. The rows hold still until it is
  clicked. The page polls `/api/operations` every two seconds.
- `op-travel` reloads that graph's commit log at the chosen operation, and the
  combobox then shows that operation's id, description and short time.
- `op-interdiff` opens the `before` graph from the `interdiff` button; the same
  spot on the before row reads `close`. Closing it stops sending the before
  ticks to the diff.
- `op-per-side` leaves the other graph's operation and ticks untouched.
- `op-loading` shows `Loading operations...` until `/api/operations` answers,
  and the error text in red when it fails.

## How to get to it (user POV)

- Open `$URL`, click the `operation` picker at the top of the graph and pick an
  operation from its list.
- Click `interdiff` to compare against a second operation; `close` removes it.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK` and prints an `early op` id.
- `OP=$(cat /tmp/diffy-verify/default/early-op)` is the full id of the
  operation right after the fixture's first commit; its first eight characters
  name its option.

- **Read the picker.** `browser_navigate` to `$URL`, `browser_wait_for` with
  `text: "fixture: merge the two topics"`, then `browser_click`
  `role=combobox[name="operation"]` and `browser_snapshot`. The `listbox`
  lists `latest (current)` as `[selected]`, then one option per operation down
  to `00000000`.
- **Travel.** `browser_click` `role=option[name=/^<first 8 of $OP>/]`, then
  `browser_wait_for` with `text: "fixture: add the notes file"`. The graph
  lists three rows: an undescribed working copy carrying `@` and `(empty)`,
  `fixture: add the notes file`, and the root.
- **Confirm against the API.** `curl -fsS "$URL/api/log?op=$OP"` returns the
  same three entries in the same order.
- **Return to the present.** Open the picker again and click
  `role=option[name="latest (current)"]`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`.
- **Interdiff.** Click `interdiff`. A `before` graph appears with its own
  picker and a `close` button. Travel it as above with both clicks scoped:
  `.pane:has(h2:text-is("before")) [role=combobox]`, then
  `.pane:has(h2:text-is("before")) >> role=option[name=/^<first 8>/]`. The
  `after` graph keeps `latest (current)` and its eight rows.
- **Newer operation.** On `latest (current)`, change the fixture, for instance
  `jj describe -m '...'` in `/tmp/diffy-verify/default/repo`. Within a few
  seconds the row gains `newer: <opId8>`; the graph still shows the old
  description. Click it and the reworded commit appears.
- **Proof.** A snapshot and an unnamed screenshot at the travelled state,
  showing the chosen operation and the shortened log.

## Gotchas

- The picker is not a `<select>`: `browser_select_option` cannot reach it.
  Click the combobox open, then click an option.
- Once the interdiff is open there are two pickers, so an unscoped
  `role=combobox[name="operation"]` is ambiguous. Scope it to a column, or
  pass the `ref`.
- Changing the fixture to drive `op-newer` changes the history every other
  recipe asserts on. Do it last, or `verify.sh stop` and `start` afterwards
  for a fresh fixture.
- A change id outlives an operation, so the same change id can name a different
  commit id on each side. The working copy at the early operation and
  `fixture: extend the notes file` at `latest (current)` are one change.
- `browser_wait_for` with `textGone` succeeds immediately after a travel,
  because the list is replaced by `Loading commits...` before the new rows
  arrive. Wait for text that must be present instead.
- Operation ids are regenerated on every fixture build. Read `$OP` at drive
  time.
- Operation labels fall back to the command line when jj records no
  description, so two operations can read alike. Pick by the id prefix, never
  by label text.
