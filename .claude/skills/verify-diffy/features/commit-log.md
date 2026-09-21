# Commit log

Each picker column, `before` and `after`, lists the repo's changes newest first,
one row per change, with a lane drawing that connects a row to its neighbours.
A row is a button: choosing it adds that commit to its column's selection, and
choosing it again drops it. What the two columns hold is what the comparison
pane diffs.

## Sub-features

- `log-rows` renders one row per change in `jj log` order, down to the root.
- `log-line` gives a row the line `jj log` prints: change id, author email,
  committer timestamp, bookmarks and tags, commit id, markers such as `@`,
  `(empty)` and `conflict`, then the first line of the description.
- `log-description` shows the first line only, and `(no description)` in italics
  when a change has none.
- `log-lane` draws a connector above and below each row, with a filled dot for
  an ordinary change and a hollow dot for a merge.
- `log-select` toggles a row in and out of its column's selection and highlights
  the rows that are in it.
- `log-sides` keeps the columns independent: choosing in `before` leaves
  `after`'s selection alone.
- `log-loading` shows `Loading commits...` until `/api/log` answers, and the
  error text in red when it fails.

## How to get to it (user POV)

- Open `$URL`. `Local history` is the landing tab and holds both columns.
- Choose rows in either column. Choose a selected row again to drop it.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- Both pickers read `latest (current)`.

- **Load the log.** `browser_navigate` to `$URL`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`. Each column lists six buttons, from
  `fixture: an empty change` down to the root row named
  `zzzzzzzz 1970-01-01 00:00:00 00000000 (empty) (no description)` with an
  `emphasis` node.
- **Address one column.** Every row name appears in both columns, so scope the
  click: `.pane:has(h2:text-is("after")) button:has-text("fixture: add a
  sidecar file")`, or click the `ref` the snapshot gives for that column.
- **Confirm the order.** Compare a column's button order against
  `curl -fsS "$URL/api/log"`. Descriptions must appear in the same order as the
  JSON array.
- **Confirm the merge marker.** `fixture: merge the two topics` is the only row
  with two entries in its `parents` array in `/api/log`. In the screenshot its
  lane dot is hollow while every other dot is filled.
- **Select and deselect.** Click a row, and the comparison pane replaces
  `Select commits on either side to compare them.` with a section for it. Click
  the same row again and the pane returns to that message.
- **Select two on one column.** The pane shows one section per commit, in log
  order.
- **Proof.** `browser_snapshot`, then `browser_take_screenshot` with no
  `filename`. Both must show the selected rows and the sections they produced
  in the same frame.

## Gotchas

- The ARIA snapshot cannot see the selection highlight or the lane dots; they
  are inline styles and an `aria-hidden` SVG. Prove those from the screenshot,
  and prove merge-ness from `/api/log` parents.
- A clicked row reports `[active]` in the snapshot because it has focus. Focus
  is not selection; the comparison pane is the selection proof.
- Descriptions arrive from jj with a trailing newline. Match on the first line.
- Change ids differ on every fixture build. Reading `ztqvtnvu` out of an old
  artifact and reusing it will click nothing.
- Choosing an operation in a column clears that column's selection. Select
  rows after travelling, not before.
- The row list is not virtualised, but the column scrolls. Use the snapshot,
  not the screenshot, to assert that a row exists.
