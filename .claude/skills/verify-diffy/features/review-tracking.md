# Review tracking

Each section in the comparison pane remembers whether it has been looked at,
which of its files were viewed, and the comments written on its lines, its
files and itself. That review document lives on the server, in a SQLite store
per repository, so every tab and every browser pointed at the same server sees
the same marks. Under the harness the store is `review.sqlite` in the run
directory, so each fixture starts empty and `verify.sh stop` removes it.

## Sub-features

- `review-mark` turns the section's `mark seen` button into `mark unseen` and
  adds a `reviewed` chip to its header.
- `review-changed` replaces that chip with `changed since you looked` when a
  section reappears with a different commit on either side.
- `review-key` files the mark under the change id, so an amended commit is
  still recognised as the same row, and the same mark shows on the Operations
  screen and in a [local review](./local-reviews.md) of that commit.
- `review-viewed` gives each file a `checkbox "Viewed"`. Ticking it folds the
  file, and the section header counts `<n> / <total> files viewed`.
- `comment-compose` opens a composer from any patch line, captioned
  `line <n>` for an after-side or context line and `line <n>, before` for a
  removal, with `comment` and `cancel` buttons.
- `comment-thread` renders a saved comment under its file as
  `<path>:<line> · open` (or `<path>:<line>, before · open`), with `resolve`
  and `delete` buttons, and the body below.
- `comment-file` opens a composer captioned `whole file` from an open file's
  `comment` header button (named `comment on file`); its thread sits under
  the file header, above the patch, as `<path> · open`.
- `comment-comparison` opens a composer captioned `whole comparison` from the
  section header's `comment on comparison` button; its thread sits between
  the section header and the files, as `whole comparison · open`.
- `comment-count` chips the number of unresolved comments in the section
  header as `<n> open`, and beside the file in the `Files changed` tree.
- `comment-stale` marks a comment written against a line that has since been
  rewritten.
- `review-persist` reads the document from `GET /api/review` on startup and
  writes every change back with `POST /api/review`. Open pages hear of each
  change over the `/api/review/changes` WebSocket. A `diffy.session.v1` left in
  `localStorage` by an older diffy is imported into the store once and
  removed.

## How to get to it (user POV)

- Tick a commit in the graph to get a section in the comparison pane.
- Use `mark seen` in the section header, tick `Viewed` on a file, and click a
  patch line to comment on it.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`, and `curl -fsS "$URL/api/review"` shows an
  empty document. A fixture an earlier drive marked up is not a clean start;
  stop and start the harness.
- One section is on screen. `fixture: add a sidecar file` gives a one-file
  patch to comment on.

- **Mark a section seen.** `browser_click` the section's `mark seen` button.
  The header gains a `reviewed` chip and the button reads `mark unseen`.
  Clicking it again takes both back.
- **Comment on a line.** `browser_click`
  `.diff-line--interactive:has-text("+sidecar")`. A composer appears reading
  `line 1` with an unnamed `textbox`. `browser_type` into
  `.comment-composer__input`, then `browser_click` `button[type=submit]`.
- **Read the thread back.** The file gains `sidecar.txt:1 · open` with
  `resolve` and `delete` buttons and the text just typed, and the section
  header gains a `1 open` chip.
- **Comment on a removal.** Tick `fixture: edit the long file and the script`,
  press `lines` on `greet.js` and click `- return "hi " + name;`. The composer
  reads `line 2, before`, and the saved thread `greet.js:2, before · open`.
- **Comment on the file or the comparison.** `browser_click` the file's
  `comment on file` button, or the section's `comment on comparison` button,
  and type and submit as above. The thread lands under the file header or
  under the section header, and the `open` chip counts it with the rest.
- **Viewed.** Tick a file's `Viewed`. The file folds and the header's count
  goes up by one.
- **Resolve and delete.** `resolve` flips the thread's meta to
  `sidecar.txt:1 · resolved`, turns the button into `reopen` and drops the
  header's `1 open` chip. `delete` removes the thread, leaving the patch alone.
- **Confirm in the store.** `curl -fsS "$URL/api/review"` lists the marks,
  comments and viewed files the UI shows, and `localStorage` holds no review
  key.
- **Prove it persists.** `browser_navigate` to `$URL` again and tick the same
  commit. The section comes back with its `reviewed` chip, its `mark unseen`
  button and its comments.
- **Proof.** A snapshot of the header chips and the thread, plus an unnamed
  screenshot; the chips are the only place the review state is visible.

## Gotchas

- Every file header carries a `comment` button, so `button:text-is("comment")`
  is ambiguous while a composer is open. Submit with `button[type=submit]`, or
  by role with the exact name `comment`, which only the submit button has.
- A folded file draws no lines at all. Unfold it from its header before
  looking for a line to comment on; a file with an open comment never starts
  folded.
- The composer's textarea has no accessible name. Address it as the section's
  `textbox`, or by `.comment-composer__input`.
- An empty or whitespace-only body is rejected silently: the form stays open
  and nothing is saved.
- The state is the server's, not the browser's. The MCP browser's `--isolated`
  profile does not reset it: marks from an earlier drive against the same
  instance are still there in a fresh browser. A stale-looking `reviewed`
  chip means an earlier drive marked it, not a bug.
- The fixture's history is fixed, so `review-changed` and `comment-stale` need
  a commit rewritten under a mark while the page is open. Rewrite one in the
  fixture repo (`/tmp/diffy-verify/default/repo`) and travel the graph back,
  rather than asserting them from the developer's own repo. Those two, and
  the live WebSocket update between two open pages, have no proven recipe
  yet.
