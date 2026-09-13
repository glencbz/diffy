# Revision diff

The right pane shows the `jj diff --git` output for the selected change, one
section per file, with a status word and path in the header and the patch body
coloured by line kind.

## Sub-features

- `diff-empty-selection` shows `Select a commit to see its diff.` before a row is
  chosen.
- `diff-files` renders one bordered section per changed file.
- `diff-status` prefixes the path with `added`, `modified`, `deleted`, and shows
  `old → new` for a rename or copy.
- `diff-colour` greys the `diff --git`/`index`/`---`/`+++` lines, blues the `@@`
  hunk headers, greens additions and reds deletions.
- `diff-none` shows `No changes in this commit.` for a change that touches no
  files.
- `diff-binary` shows `Binary file, no textual diff.` instead of a patch.

## How to get to it (user POV)

- Choose any commit row in the left pane.
- Choose a past operation first, then a row, to diff that change as it was.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- No row is selected: the right pane reads `Select a commit to see its diff.`

- **Modified file.** `browser_click` on
  `button:has-text("fixture: extend the notes file")`, then `browser_wait_for`
  with `text: "notes.txt"`. The snapshot shows `modified notes.txt` and the
  patch lines `@@ -1,1 +1,2 @@`, ` line one`, `+line two`.
- **Added file.** `browser_click` on
  `button:has-text("fixture: add a sidecar file")`, then `browser_wait_for` with
  `text: "sidecar.txt"`. The header reads `added sidecar.txt`.
- **No changes.** `browser_click` on
  `button:has-text("fixture: an empty change")`, then `browser_wait_for` with
  `text: "No changes in this commit."`. The merge row and the root row behave
  the same way.
- **Confirm against the API.** Take the change id from the row's accessible name
  and run `curl -fsS "$URL/api/diff?rev=<changeId>"`. The `status`, `path` and
  `patch` must match what the pane rendered.
- **Proof.** `browser_snapshot` for the patch text, plus an absolute-path
  `browser_take_screenshot` for the colouring.

## Gotchas

- The pane renders `jj`'s raw `--git` patch, headers included. Do not assert on
  a cleaned-up patch body.
- Blank patch lines are rendered as a single space so the row keeps its height.
  A snapshot line reading `" "` is expected.
- Colour only exists in the screenshot; the ARIA tree carries no styling.
- The fixture has no binary file, no rename and no delete, so `diff-binary`,
  the rename arrow and `deleted` are unproven by the fixture alone. Extend the
  fixture in `harness/verify.sh` rather than asserting them from a hand-made
  commit in the developer's repo.
- Selecting a row while a past operation is active diffs the change at that
  operation. Reset the picker to `latest (current)` before diffing head state.
