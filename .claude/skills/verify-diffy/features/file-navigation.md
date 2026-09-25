# File navigation

A comparison that touches more than one file gets two ways to move between
them. Each section lists its files as a `Files changed` tree above its patches,
and the pane as a whole gets a navigator that steps through every file of every
section and opens a filterable list of them.

## Sub-features

- `files-summary` heads a section that changed two or more files with a
  `Files changed` region: the file count, total added and removed lines, a bar
  of their proportion, and a folder tree whose rows carry a status letter
  (`A`, `M`, `D`, `R`, `C`), the path, an open-comment count and the file's
  own `+`/`−` counts. Clicking a row scrolls to that file.
- `files-navigator` appears above the pane once the whole comparison spans two
  or more files. `Previous file` and `Next file` step through them, and
  `Show changed files` reads `<n> / <total>` and the current path, which
  follows the reader's scrolling.
- `files-sheet` is what `Show changed files` opens: a `Changed files` dialog
  with a `Filter files` textbox over the same tree, grouped by section when
  there is more than one. Picking a file scrolls to it and closes the dialog.
- `files-narrow` moves the navigator to a bar along the bottom of the screen
  in the [narrow layout](./narrow-layout.md).

## How to get to it (user POV)

- Select any commit, or pair of commits, whose diff touches two or more files.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.

- **Summary.** Click `fixture: edit the long file and the script` in the
  `after` column and wait for `greet.js`. The `Files changed` region reads
  `3 files`, `+3`, `−4`, and lists `D bun.lock −1`, `M greet.js +1 −1` and
  `M long.txt +2 −2`.
- **Navigator.** `Show changed files` reads `1 / 3` and `bun.lock`. Click
  `Next file`; it reads `2 / 3` and `greet.js`.
- **Sheet and filter.** Click `Show changed files`. A `dialog "Changed files"`
  opens listing the three files. `browser_type` `greet` into
  `textbox "Filter files"`; only `M greet.js +1 −1` remains. Click it; the
  dialog closes and the navigator reads `2 / 3` `greet.js`.
- **Thresholds.** Select `fixture: add a sidecar file` alone. With one file in
  the comparison there is neither a `Files changed` region nor a navigator.
- **Proof.** A snapshot of the region and the dialog, plus an unnamed
  screenshot of the summary bar.

## Gotchas

- The summary is per section and the navigator is per comparison, so two
  one-file sections show a navigator reading `1 / 2` but no summary.
- The navigator's path is prefixed with an invisible left-to-right mark, so
  match it with `has-text`, not an exact string.
- A deleted file's name is struck through in the tree; the strike is styling
  and does not appear in the ARIA name.
