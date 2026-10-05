# Commit graph

The `Operations` tab, at `/`, opens on one column headed `commits`: the repo's
changes newest first, one row per change, drawn on a coloured lane graph. A row
is a button: choosing it ticks that commit into the selection, and choosing it
again drops it. The diff pane beside the column shows what the ticks hold. The
`interdiff` toggle on the picker row opens a second graph, `before`, to compare
against; see [operation history](./operation-history.md).

## Sub-features

- `log-rows` renders one row per change in `jj log` order, down to the root.
- `log-line` gives a row the line `jj log` prints: change id, author email,
  committer timestamp, bookmarks and tags, commit id, markers such as `@`,
  `(empty)` and `conflict`, then the first line of the description.
- `log-description` shows the first line only, and `(no description)` in italics
  when a change has none.
- `log-lane` draws each topic in its own colour, with a filled dot for an
  ordinary change and a hollow dot for a merge.
- `log-select` toggles a row in and out of the selection and highlights the
  rows that are in it. The `review` button on the picker row counts the ticks,
  `review 2`.
- `log-sides` keeps the two graphs independent once the interdiff is open:
  ticking in `before` leaves `after`'s ticks alone.
- `log-resize` puts a `separator "resize the commits column"` between the
  column and the diff pane.
- `log-loading` shows `Loading commits...` until `/api/log` answers, and the
  error text in red when it fails.

## How to get to it (user POV)

- Open `$URL`. `Operations` is the landing screen, though `Local reviews` is
  the first tab.
- Choose rows. Choose a ticked row again to drop it.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- The picker reads `latest (current)` and the interdiff is closed.

- **Load the log.** `browser_navigate` to `$URL`, then `browser_wait_for` with
  `text: "fixture: merge the two topics"`. The `commits` column lists eight
  buttons, from `fixture: edit the long file and the script` down to the root
  row named `zzzzzzzz 1970-01-01 00:00:00 00000000 (empty) (no description)`
  with an `emphasis` node. The diff pane reads `Select commits to see their
  diff.`
- **Confirm the order.** Compare the button order against
  `curl -fsS "$URL/api/log"`. Descriptions must appear in the same order as the
  JSON array.
- **Confirm the merge marker.** `fixture: merge the two topics` is the only row
  with two entries in its `parents` array in `/api/log`. In the screenshot its
  lane dot is hollow while every other dot is filled.
- **Select and deselect.** Click a row; the pane replaces the idle message with
  a section for it, and the toggle reads `review 1`. Click the same row again
  and the pane returns to the message.
- **Select two.** The pane shows one section per commit, in log order, and the
  navigator above it counts the files of both.
- **Address one graph.** With the interdiff open, every row name appears in
  both graphs, so scope the click:
  `.pane:has(h2:text-is("after")) button:has-text("fixture: add a sidecar
  file")`, or click the `ref` the snapshot gives for that column.
- **Proof.** `browser_snapshot`, then `browser_take_screenshot` with no
  `filename`. Both must show the ticked rows and the sections they produced
  in the same frame.

## Gotchas

- The column is headed `commits` until the interdiff opens, and then `after`.
  A `.pane:has(h2:text-is("after"))` selector matches nothing on the lone
  graph.
- The ARIA snapshot cannot see the selection highlight or the lane dots; they
  are styles and an `aria-hidden` SVG. Prove those from the screenshot, and
  prove merge-ness from `/api/log` parents.
- A clicked row reports `[active]` in the snapshot because it has focus. Focus
  is not selection; the diff pane is the selection proof.
- Descriptions arrive from jj with a trailing newline. Match on the first line.
- Change ids differ on every fixture build. Reading one out of an old artifact
  and reusing it will click nothing.
- The ticks live in the page's memory, not the address or the review store,
  so a reload drops them.
