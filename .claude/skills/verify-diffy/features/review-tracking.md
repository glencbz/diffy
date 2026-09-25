# Review tracking

Each section in the comparison pane remembers whether it has been looked at and
carries the comments written on its lines, its files and itself. The memory lives in the browser,
under the `localStorage` key `diffy.session.v1`, so it survives a reload and
belongs to the profile rather than the repo.

## Sub-features

- `review-mark` turns the section's `mark seen` button into `mark unseen` and
  adds a `reviewed` chip to its header.
- `review-changed` replaces that chip with `changed since you looked` when a
  section reappears with a different commit on either side.
- `review-key` files the mark under the change id, so an amended commit is
  still recognised as the same row; a backend with no change ids files it under
  the exact revision instead.
- `comment-compose` opens a composer on an after-side patch line, captioned
  `line <n>`, with `comment` and `cancel` buttons.
- `comment-thread` renders a saved comment under its file as
  `<path>:<line> · open`, with `resolve` and `delete` buttons, and the body
  below.
- `comment-file` opens a composer captioned `whole file` from an open file's
  `comment` header button (named `comment on file`); its thread sits under the file header,
  above the patch, as `<path> · open`.
- `comment-comparison` opens a composer captioned `whole comparison` from the
  section header's `comment on comparison` button; its thread sits between
  the section header and the files, as `whole comparison · open`.
- `comment-count` chips the number of unresolved comments in the section
  header as `<n> open`.
- `comment-stale` marks a comment written against a line that has since been
  rewritten.
- `review-persist` reloads the whole document from `localStorage` on startup,
  and ignores a blob it cannot parse rather than failing to start.

## How to get to it (user POV)

- Select a commit in either column to get a section in the comparison pane.
- Use `mark seen` in the section header, and click a patch line to comment on
  it.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- One section is on screen. `fixture: add a sidecar file` on the `after` column
  gives a one-file patch to comment on.

- **Mark a section seen.** `browser_click` the section's `mark seen` button.
  The header gains a `reviewed` chip and the button reads `mark unseen`.
  Clicking it again takes both back.
- **Comment on a line.** `browser_click`
  `.diff-line--interactive:has-text("+sidecar")`. A composer appears reading
  `line 1` with an unnamed `textbox`. `browser_type` into it, then
  `browser_click` the `comment` button.
- **Read the thread back.** The file gains `sidecar.txt:1 · open` with
  `resolve` and `delete` buttons and the text just typed, and the section
  header gains a `1 open` chip.
- **Comment on the file or the comparison.** `browser_click` the file's
  `comment on file` button, or the section's `comment on comparison` button,
  and type and submit as above. The thread lands under the file header or
  under the section header, and the `open` chip counts it with the rest.
- **Resolve and delete.** `resolve` flips the thread's meta to
  `sidecar.txt:1 · resolved`, turns the button into `reopen` and drops the
  header's `1 open` chip. `delete` removes the thread, leaving the patch alone.
- **Prove it persists.** `browser_navigate` to `$URL` again and reselect the
  same commit. The section comes back with its `reviewed` chip, its `mark
  unseen` button and its comments.
- **Proof.** A snapshot of the header chips and the thread, plus an unnamed
  screenshot; the chips are the only place the review state is visible.

## Gotchas

- Only after-side lines can be commented on, in either diff view. An added or
  context line is a `button`; a removal or a patch header is a static `div` and
  clicking it does nothing. The `show N unchanged lines` gap is also a
  `button`, but it expands context rather than opening a composer.
- A folded file draws no lines at all. Unfold it from its header before
  looking for a line to comment on; a file with an open comment never starts
  folded.
- The composer's textarea has no accessible name. Address it as the section's
  `textbox`, or by `.comment-composer__input`.
- An empty or whitespace-only body is rejected silently: the form stays open
  and nothing is saved.
- The MCP browser runs `--isolated`, so the profile starts empty on every
  connection. Marks and comments survive a reload inside one run and never leak
  into the next.
- The fixture's history is fixed, so `review-changed` and `comment-stale` need
  a commit rewritten under a mark while the page is open. Rewrite one in the
  fixture repo (`/tmp/diffy-verify/default/repo`) and travel the column back,
  rather than asserting them from the developer's own repo.
- The marks are per browser profile, not per repo. A stale-looking `reviewed`
  chip means a previous drive in the same session marked it, not a bug.
