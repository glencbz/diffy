# Local reviews

A local review is a series of commits declared ready for review, by a reader
from the Operations graph or by an agent through the API. Each registration is
a version, `v1`, `v2`, ..., of (operation, revset). The `Local reviews` tab
lists them and reads one in the same series screen the pull request tab uses:
version pickers, a commit stack, and per-commit diffs with the usual review
tracking.

## Sub-features

- `register-strip` opens from the `review` button on the Operations picker
  row (named `register the ticked commits as a local review`, `close the
  review strip` while open, and counting the ticks, `review 2`). The strip
  shows `<n> commits`, a `textbox "review name"` defaulting to the first
  tick's short change id, `create review`, `close`, and a `textbox "revset"`
  that follows the ticks. Only the lone graph offers it.
- `register-revset` names the ticks in the shortest revset that says the same
  thing: one tick is its change id prefix, a stack from trunk is
  `trunk()..<change id>`.
- `register-done` answers `Registered <name>.` with an `open it` link, and
  turns the button into `replace v<n> of <name>`.
- `register-api` is `POST /api/local/reviews` with `{name, revset,
  operation}`. With no name or revset it takes the nearest bookmark at or
  below the working copy; with none it answers 400.
- `reviews-list` at `/reviews` lists each review as a button reading
  `v<n> <name> <revset>` over its newest version's commits, and
  `Select a local review to read it.` until one is picked.
- `reviews-read` at `/reviews/<name>` heads the screen with the name and
  revset, a `from` picker (`base (the parents of the oldest commit)` or a
  version) and a `to` picker of versions, the whole review's file count and
  `+`/`-` lines, and `Mark reviewed at v<n>`.
- `reviews-stack` lists the version's commits oldest first, with
  `previous commit` and `next commit` buttons and a `fold` toggle, then a card
  per commit: its message, `mark seen`, `comment on this commit`, and a
  `<n> files +a -r what this commit adds` button that opens its diff in place.
- `reviews-address` keeps the place in the address:
  `/reviews/<name>/commits/<commit id>?to=<version>`, and each file header's
  path is a link to `.../files/<path>?to=<version>`. In this screen a file
  header is two controls: a fold button named for the status (`modified`) and
  that link.
- `reviews-shared-state` files marks and comments under the change id, so a
  mark or comment made on the Operations screen shows on the same commit here.
- `reviews-rail` is the `show the local review list` button down the left
  edge, which returns to `/reviews`.

## How to get to it (user POV)

- On Operations, tick commits, click `review`, name the review and click
  `create review`, then `open it`.
- Or click `Local reviews` in the top navigation and pick one from the list.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK` and `curl -fsS "$URL/api/review"` shows an
  empty `localReviews`.

- **Register from the graph.** On `$URL`, tick
  `fixture: edit the long file and the script` and click
  `button:has-text("review 1")`. The strip reads `1 commit`, the name box holds
  the change id prefix and the revset box the same id. Tick
  `fixture: add a long file, a lock file and a script`; the revset becomes
  `trunk()..<change id>`. `browser_type` `long-file` into
  `textbox "review name"` and click `create review`. The strip reads
  `Registered long-file.` and the button `replace v1 of long-file`.
- **Open it.** Click `text=open it`. The address is `/reviews/long-file`, the
  header reads `long-file trunk()..<change id>`, the `to` picker reads
  `v1 (...)` and the stack lists `2 commits`.
- **Read a commit.** Click the `3 files +3 -4 what this commit adds` button
  (find it by text; take the `ref`). Its `Files changed` tree and files open
  below. Clicking a file in the tree moves the address to
  `/reviews/long-file/commits/<commit id>?to=1`.
- **Shared state.** Marks or comments made on the Operations screen for the
  same commit show on its card here (`reviewed`, `1 open`).
- **The list.** Click `show the local review list`. The address is
  `/reviews` and the list holds `v1 long-file trunk()..<change id>`.
- **Register through the API.**
  `curl -s -X POST "$URL/api/local/reviews" -H 'content-type: application/json'
  -d '{"name":"sidecar","revset":"description(glob:\"fixture: add a sidecar*\")"}'`
  answers `{"name":"sidecar","snapshot":...}`. A revset jj refuses answers 400
  with jj's message, and `-d '{}'` answers 400
  `no bookmark sits at or below the working copy, ...` because the fixture
  has no bookmark.
- **Proof.** A snapshot of the strip after registering, and an unnamed
  screenshot of the review screen with a commit open.

## Gotchas

- The commit stack draws each row twice, one copy hidden for another layout,
  so `text=<description>` resolves to an invisible node and the click times
  out. Click the row's button by its full accessible name or its `ref`.
- The fixture has no remote, so `trunk()` is the root commit and every stack
  from the root reads `trunk()..`.
- Registering is real state in the run's review store. A second drive against
  the same instance finds the review already there, and `create review` turns
  into `replace v1`; `verify.sh stop` and `start` for a clean list.
- Comparing two versions needs a second registration of the same name after
  the commits change; the `from` picker offers each earlier version. That
  path, and typing a revset into the strip to tick what it names, have no
  proven recipe yet.
