# Comparison pane

The third column diffs what the two picker columns hold. The backend pairs the
two selections commit by commit and answers one row per pair, so the pane shows
a section per row: a header naming the commit on each side, then the files that
row changed. Each file has a header that folds it and a switch between
difftastic's structural reading and the plain line diff.

A pair of commits yields the interdiff between them. A commit only one side
selected yields its own diff, with `not in this series` where the other side's
commit would be.

Finding your way between files, the `Files changed` summary and the navigator
above the pane, is its own feature: see [file navigation](./file-navigation.md).

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
- `diff-fold` makes each file header a toggle that folds the file's body. A
  lock file, a generated file and a diff over 400 changed lines start folded,
  with the reason (`lock file`, `generated`, `large diff, N changed lines`)
  beside the path, unless the file already carries an open comment.
- `diff-mode` gives each file a `Diff view` pair of buttons, `structural` and
  `lines`. Files open in the mode chosen under [settings](./settings.md),
  `structural` by default. `structural` is disabled when difftastic has no
  reading of the file, as for an added, deleted or binary one, and that file
  opens as `lines`.
- `diff-headers` draws jj's raw `diff --git`, `index`, `---` and `+++` lines in
  the `lines` view only. The `structural` view starts at the `@@` hunk header.
- `diff-gap` hides the unchanged lines between two hunks behind a
  `⋯ show N unchanged lines` button that expands them in place.
- `diff-colour` tints added and removed rows green and red, colours the `+`
  and `-` signs to match, highlights the code itself by syntax, and marks the
  words an edited line changed with a stronger tint. Hunk headers are blue.
- `diff-gutter` numbers each after-side line in the left gutter and leaves it
  blank for removals and patch headers.
- `diff-binary` shows `Binary file, no textual diff.` instead of a patch.
- `diff-sticky` keeps a file's header pinned to the top of the pane while its
  body scrolls past.
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
- `diffy.settings.v1` is unset or leaves diffs starting as `structural`; the
  MCP browser's `--isolated` profile starts that way.

- **One commit, one side.** Click `fixture: add a sidecar file` in the `after`
  column, then `browser_wait_for` with `text: "sidecar.txt"`. The header reads
  `before` `not in this series`, `after` the commit's log line; the file header
  is the button `added sidecar.txt`, `structural` is disabled, and the patch
  ends in the line `+sidecar` numbered `1`.
- **Fold, delete, modes and gaps.** Click `fixture: add a sidecar file` again
  to clear it, then `fixture: edit the long file and the script`. Assert:
  - `deleted bun.lock` is a collapsed toggle with `lock file` beside it and no
    patch lines. Clicking it expands `-lockfileVersion: 1`.
  - `modified greet.js` and `modified long.txt` open with `structural`
    pressed, and their first line is an `@@` hunk header.
  - `long.txt` has a `⋯ show 49 unchanged lines` button between its two hunks.
    Clicking it puts `30 long line 30` on screen.
  - Pressing `lines` on `greet.js` brings back its `diff --git a/greet.js
    b/greet.js` header.
- **A commit with no files.** Click `fixture: an empty change` in the `after`
  column. Its section reads `No changes in this commit.` The merge row and the
  root row behave the same way.
- **The same commit on both sides.** Select `fixture: add a sidecar file` in
  both columns. The one section reads `Both commits make the same change.`
- **A real interdiff.** Select `fixture: extend the notes file` on `before` and
  `fixture: add the notes file` on `after`. The section carries both commits in
  its header and a patch per file the two versions disagree about.
- **Confirm against the API.** Take the full commit ids from `/api/log` and run
  `curl -fsS "$URL/api/interdiff?from=<fromCommitId>&to=<toCommitId>"`. The
  `rows[].files[]` `status`, `path` and `patch` must match what the `lines`
  view rendered, and `structural.kind` must match whether `structural` was
  enabled.
- **Proof.** `browser_snapshot` for headers, fold state and patch text, plus an
  unnamed `browser_take_screenshot` of `greet.js` for the colouring. Its edited
  line shows `hi` and `hello, `/`there ` in the stronger word tint.

## Gotchas

- A file header is a `button` named with a space, `added sidecar.txt`, and
  clicking it folds the file. Click a line or a switch button, never the
  header, when you only mean to look.
- The snapshot shows `[expanded]` on an open file header and nothing on a
  folded one; `aria-expanded="false"` does not print.
- Blank patch lines are rendered as a single space so the row keeps its height.
  A snapshot line reading `" "` is expected.
- An added or context line is a `button`, because clicking it opens the comment
  composer. See [review tracking](./review-tracking.md).
- Colour, syntax highlighting and word marks exist only in the screenshot; the
  ARIA tree carries no styling.
- `structural` disabled on every file, including `greet.js`, means the server
  has no difftastic. `verify.sh` runs it inside the `nix` runtime that provides
  one; an instance started any other way does not prove `diff-mode`.
- The fixture has no binary file, no rename and no generated or oversized
  file, so `diff-binary`, the rename arrow and the other fold reasons are
  unproven by the fixture alone. Extend the fixture in `harness/verify.sh`
  rather than asserting them from a hand-made commit in the developer's repo.
- `/api/interdiff` takes full commit ids. A short id is not an error: it
  matches no commit and the row is dropped, so the answer is `{"rows":[]}`.
