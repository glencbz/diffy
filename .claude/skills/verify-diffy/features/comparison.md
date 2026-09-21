# Comparison pane

The third column diffs what the two picker columns hold. The backend pairs the
two selections commit by commit and answers one row per pair, so the pane shows
a section per row: a header naming the commit on each side, then the files that
row changed, with the patch body coloured by line kind.

A pair of commits yields the interdiff between them. A commit only one side
selected yields its own diff, with `not in this series` where the other side's
commit would be.

## Sub-features

- `comparison-idle` shows `Select commits on either side to compare them.`
  while both columns are empty.
- `comparison-rows` renders one section per paired row, in log order.
- `comparison-header` captions the two commits `before` and `after`, each drawn
  as the same `jj log` line the picker rows use.
- `comparison-lone` shows `not in this series` in italics for the side that
  selected nothing, and the commit's own diff below.
- `comparison-same` shows `Both commits make the same change.` when a pair's
  interdiff is empty.
- `comparison-none` shows `No changes in this commit.` for a lone commit that
  touches no files.
- `diff-status` prefixes the path with `added`, `modified`, `deleted`, and
  shows `old → new` for a rename or copy.
- `diff-colour` greys the `diff --git`/`index`/`---`/`+++` lines, blues the
  `@@` hunk headers, greens additions and reds deletions.
- `diff-gutter` numbers each after-side line in the left gutter and leaves it
  blank for removals and patch headers.
- `diff-binary` shows `Binary file, no textual diff.` instead of a patch.
- `comparison-loading` shows `Loading diff...` until `/api/interdiff` answers,
  and the error text in red when it fails.

## How to get to it (user POV)

- Choose one or more rows in either column, or in both.
- Choose a past operation in a column first to compare a commit as it was.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- Nothing is selected: the pane reads
  `Select commits on either side to compare them.`

- **One commit, one side.** Click `fixture: add a sidecar file` in the `after`
  column, then `browser_wait_for` with `text: "sidecar.txt"`. The header reads
  `before` `not in this series`, `after` the commit's log line; the file header
  is `added sidecar.txt`, and the patch ends in the line `+sidecar` numbered
  `1`.
- **A commit with no files.** Click `fixture: an empty change` in the same
  column. Its section reads `No changes in this commit.` The merge row and the
  root row behave the same way.
- **The same commit on both sides.** Click `fixture: add a sidecar file` in the
  `before` column as well. The one remaining section reads
  `Both commits make the same change.`
- **A real interdiff.** Select `fixture: extend the notes file` on `before` and
  `fixture: add the notes file` on `after`. The section carries both commits in
  its header and a patch per file the two versions disagree about.
- **Confirm against the API.** Take the full commit ids from `/api/log` and run
  `curl -fsS "$URL/api/interdiff?from=<fromCommitId>&to=<toCommitId>"`. The
  `rows[].files[]` `status`, `path` and `patch` must match what the pane
  rendered.
- **Proof.** `browser_snapshot` for the header and patch text, plus an unnamed
  `browser_take_screenshot` for the colouring.

## Gotchas

- The pane renders `jj`'s raw `--git` patch, headers included. Do not assert on
  a cleaned-up patch body.
- Blank patch lines are rendered as a single space so the row keeps its height.
  A snapshot line reading `" "` is expected.
- A file header is one node in the ARIA tree, so the status and path read as
  `addedsidecar.txt`. The space is styling, not text.
- An added or context line is a `button`, because clicking it opens the comment
  composer. Removals and patch headers are static `div`s. See
  [review tracking](./review-tracking.md).
- Colour only exists in the screenshot; the ARIA tree carries no styling.
- The fixture has no binary file, no rename and no delete, so `diff-binary`,
  the rename arrow and `deleted` are unproven by the fixture alone. Extend the
  fixture in `harness/verify.sh` rather than asserting them from a hand-made
  commit in the developer's repo.
- `/api/interdiff` takes full commit ids. A short id is not an error: it
  matches no commit and the row is dropped, so the answer is `{"rows":[]}`.
