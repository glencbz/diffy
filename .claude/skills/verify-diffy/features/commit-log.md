# Commit log

The left pane lists the repo's changes newest first, one row per change, each
showing an eight-character change id, the first line of its description, and a
lane drawing that connects the row to its neighbours. Choosing a row selects
that change for the diff pane.

## Sub-features

- `log-rows` renders one row per change in `jj log` order, down to the root.
- `log-description` shows the first line only, and `(no description)` in italics
  when a change has none.
- `log-lane` draws a connector above and below each row, with a filled dot for
  an ordinary change and a hollow dot for a merge.
- `log-select` highlights the chosen row and drives the diff pane.
- `log-loading` shows `Loading commits...` until `/api/log` answers, and the
  error text in red when it fails.

## How to get to it (user POV)

- Open `$URL`. The log is the landing view; there is no other route.
- Choose a commit row to select it.
- Choose a different operation in the picker above, which reloads the log and
  clears the selection.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- The picker reads `latest (current)`.

- **Load the log.** `browser_navigate` to `$URL`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`. The snapshot lists six buttons, from
  `fixture: an empty change` down to the root row named
  `<changeId8> (no description)` with an `emphasis` node.
- **Confirm the order.** Compare the snapshot's button order against
  `curl -fsS "$URL/api/log"`. Descriptions must appear in the same order as the
  JSON array.
- **Confirm the merge marker.** `fixture: merge the two topics` is the only row
  with two entries in its `parents` array in `/api/log`. In the screenshot its
  lane dot is hollow while every other dot is filled.
- **Select a row.** `browser_click` with
  `target: 'button:has-text("fixture: extend the notes file")'`. The right pane
  replaces `Select a commit to see its diff.` with the file header
  `modified notes.txt`, and the row's background turns pale blue.
- **Proof.** `browser_snapshot`, then `browser_take_screenshot` with an absolute
  `filename` under `.claude/verify-artifacts/`. Both must show the selected row
  and the diff it produced in the same frame.

## Gotchas

- The ARIA snapshot cannot see the selection highlight or the lane dots; they
  are inline styles and an `aria-hidden` SVG. Prove those from the screenshot,
  and prove merge-ness from `/api/log` parents.
- A clicked row reports `[active]` in the snapshot because it has focus. Focus is
  not selection; the diff pane is the selection proof.
- Descriptions arrive from jj with a trailing newline. Match on the first line.
- Change ids differ on every fixture build. Reading `uqryzkqk` out of an old
  artifact and reusing it will click nothing.
- The row list is not virtualised, but the pane scrolls. Use the snapshot, not
  the screenshot, to assert that a row exists.
