# Comparison pane

The pane beside the graph diffs what the graphs hold. The backend pairs the two
selections commit by commit and answers one row per pair, so the pane shows a
section per row: a header naming the commits, then the files that row changed.
Each file has a header that folds it, a switch between difftastic's structural
reading and the plain line diff, a `comment` button and a `Viewed` checkbox.

On the lone graph each ticked commit yields its own diff. With the interdiff
open, a pair of commits yields the interdiff between them, and a commit only
one side ticked yields its own diff with `not in this series` where the other
side's commit would be.

Finding your way between files, the `Files changed` summary and the navigator
above the pane, is its own feature: see [file navigation](./file-navigation.md).
Marks, `Viewed` and comments are [review tracking](./review-tracking.md).

## Sub-features

- `comparison-idle` shows `Select commits to see their diff.` while nothing is
  ticked.
- `comparison-rows` renders one section per paired row, in log order.
- `comparison-header` captions a lone commit `commit`, and an interdiff row
  `before` and `after`, each drawn as the same `jj log` line the graph rows use.
- `comparison-lone` shows `not in this series` in italics for the interdiff
  side that has no commit in that row, and the commit's own diff below.
- `comparison-same` shows `Both commits make the same change.` when a pair's
  interdiff is empty.
- `comparison-none` shows `No changes in this commit.` for a lone commit that
  touches no files.
- `diff-status` prefixes the path with `added`, `modified`, `deleted`, and
  shows `old → new` for a rename or copy.
- `diff-fold` makes each file header a toggle that folds the file's body. A
  lock file, a generated file and a diff over 400 changed lines start folded,
  with the reason (`lock file`, `generated`, `large diff, N changed lines`)
  beside the path, unless the file already carries an open comment. Ticking
  `Viewed` folds the file too.
- `diff-mode` gives each file a `Diff view` pair of buttons, `structural` and
  `lines`. Files open in the mode chosen under [settings](./settings.md),
  `structural` by default. `structural` is disabled when difftastic has no
  reading of the file, as for an added, deleted or binary one, and that file
  opens as `lines`.
- `diff-hunks` starts both views at the `@@` hunk header. jj's `diff --git`,
  `index`, `---` and `+++` lines are not drawn in either.
- `diff-gap` hides the unchanged lines between two hunks behind a
  `⋯ show N unchanged lines` button that expands them in place.
- `diff-colour` tints added and removed rows green and red, colours the `+`
  and `-` signs to match, highlights the code itself by syntax, and marks the
  words an edited line changed with a stronger tint. Hunk headers are blue.
- `diff-gutter` numbers each after-side line in the left gutter and leaves it
  blank for removals.
- `diff-split` lays every file out in two columns once Settings asks for
  `Side by side`, at any width and in either view:
  `.diff-file__patch--split`, each line a `.diff-line--before` or
  `.diff-line--after` cell numbered by its own side, a removed run beside the
  added run after it, `.diff-line--empty` where a run is shorter. After cells
  and removed before cells are buttons; a context line's before cell is not.
- `diff-binary` shows `Binary file, no textual diff.` instead of a patch.
- `diff-sticky` keeps a file's header pinned to the top of the pane while its
  body scrolls past.
- `comparison-loading` shows `Loading diff...` until `/api/interdiff` answers,
  and the error text in red when it fails.

## How to get to it (user POV)

- Tick one or more rows in the graph.
- Open the interdiff and tick on both sides to compare two versions of a
  series, or travel the before graph to a past operation first.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- Nothing is ticked: the pane reads `Select commits to see their diff.`
- `diffy.settings.v1` is unset or leaves diffs starting as `structural`; the
  MCP browser's `--isolated` profile starts that way.

- **One commit.** Click `fixture: add a sidecar file`, then `browser_wait_for`
  with `text: "sidecar.txt"`. The header reads `commit` and the commit's log
  line; the file header is the button `added sidecar.txt`, `structural` is
  disabled, and the patch is `@@ -0,0 +1,1 @@` then the button `1 +sidecar`.
- **Fold, delete, modes and gaps.** Click the sidecar row again to clear it,
  then `fixture: edit the long file and the script`. Assert:
  - `deleted bun.lock` is a collapsed toggle with `lock file` beside it and no
    patch lines. Clicking it expands `-lockfileVersion: 1`.
  - `modified greet.js` and `modified long.txt` open with `structural`
    pressed, and their first line is an `@@` hunk header.
  - `long.txt` has a `⋯ show 49 unchanged lines` button between its two hunks.
    Clicking it puts `30 long line 30` on screen.
  - Pressing `lines` on `greet.js` still starts at `@@ -1,3 +1,3 @@`.
- **A commit with no files.** Click `fixture: an empty change`. Its section
  reads `No changes in this commit.` The merge row and the root row behave the
  same way.
- **The same commit on both sides.** Click `interdiff`, then tick
  `fixture: add a sidecar file` in both graphs. The one section is captioned
  `before` and `after` and reads `Both commits make the same change.`
- **A lone row in an interdiff.** Tick `fixture: extend the notes file` on
  `before`, and `fixture: add the notes file` and `fixture: add a sidecar file`
  on `after`. The sidecar section reads `before not in this series`; the notes
  section carries both commits.
- **Confirm against the API.** Take the full commit ids from `/api/log` and run
  `curl -fsS "$URL/api/interdiff?from=<fromCommitId>&to=<toCommitId>"`. The
  `rows[].files[]` `status`, `path` and `patch` must match what the `lines`
  view rendered, and `structural.kind` must match whether `structural` was
  enabled.
- **Proof.** `browser_snapshot` for headers, fold state and patch text, plus an
  unnamed `browser_take_screenshot` of `greet.js` for the colouring. Its edited
  line shows `hi` and `hello, `/`there ` in the stronger word tint.
- **Side by side.** In Settings pick `Side by side`, then tick
  `fixture: edit the long file and the script`. `long.txt` draws
  `2 -long line 2` in a `.diff-line--before` row beside `2 +long line two`
  in a `.diff-line--after` one. Resizing to 412 wide keeps
  `.diff-file__patch--split` in two columns.

## Gotchas

- A file header is a `button` named with a space, `added sidecar.txt`, and
  clicking it folds the file. Click a line or a switch button, never the
  header, when you only mean to look.
- The snapshot shows `[expanded]` on an open file header and nothing on a
  folded one; `aria-expanded="false"` does not print.
- Blank patch lines are rendered as a single space so the row keeps its height.
  A snapshot line reading `" "` is expected.
- Every patch line, removals included, is a `button`, because clicking it opens
  the comment composer. Hunk headers are not.
- Colour, syntax highlighting and word marks exist only in the screenshot; the
  ARIA tree carries no styling.
- `structural` disabled on every file, including `greet.js`, means the server
  has no difftastic. `verify.sh` runs it inside the `nix` runtime that provides
  one; an instance started any other way does not prove `diff-mode`.
- Pairing a commit with its own parent, as the lone-row recipe does with the
  notes commits, rebases one onto the other's parents, so `notes.txt` shows
  jj's conflict markers as removed lines. That is jj's interdiff, not a broken
  diff. The pair also shows a `JJ-COMMIT-DESCRIPTION` file for the reworded
  description.
- The fixture has no binary file, no rename and no generated or oversized
  file, so `diff-binary`, the rename arrow and the other fold reasons are
  unproven by the fixture alone. Extend the fixture in `harness/verify.sh`
  rather than asserting them from a hand-made commit in the developer's repo.
- `/api/interdiff` takes full commit ids. A short id is not an error: it
  matches no commit and the row is dropped, so the answer is `{"rows":[]}`.
