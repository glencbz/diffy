# Settings

`Settings` is the third tab in the top navigation, beside `Local history` and
`Pull requests`. It holds display preferences that live in the browser, not
the repo, and apply everywhere at once.

## Sub-features

- `settings-tabs` is the top `navigation` of three buttons, each with a path
  of its own: `Local history` at `/`, the landing tab, `Pull requests` at
  `/pulls` and `Settings` at `/settings`. Switching away and back keeps each
  column's selection.
- `settings-text-size` is a `Text size` radio group, `Small`, `Standard`,
  `Large` and `Larger`, `Standard` by default. The choice lands on
  `document.documentElement.dataset.textSize` and scales the app's text; a
  diff line goes from 12px at `Standard` to 16px at `Larger`.
- `settings-diff-mode` is a `Diffs start as` radio group,
  `Structural, with difftastic` by default or `Line by line`. It decides which
  side of each file's `Diff view` switch is pressed when the file first opens;
  see [the comparison pane](./comparison.md).
- `settings-persist` stores both in `localStorage` under `diffy.settings.v1`
  as `{"display": {"textSize", "diffMode"}}`, so they survive a reload.

## How to get to it (user POV)

- Click `Settings` in the top navigation, or open `$URL/settings`.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- The MCP browser's `--isolated` profile starts with no `diffy.settings.v1`.

- **Defaults.** `browser_click` `nav button:text-is("Settings")`. The snapshot
  shows `group "Text size"` with `Standard` checked and `group "Diffs start as"`
  with `Structural, with difftastic` checked.
- **Change both.** Click `radio "Larger"` and `radio "Line by line"`.
  `browser_evaluate` reads `document.documentElement.dataset.textSize` as
  `larger`, and `localStorage["diffy.settings.v1"]` as
  `{"display":{"textSize":"larger","diffMode":"line"}}`.
- **They apply and persist.** `browser_navigate` to `$URL` and select
  `fixture: edit the long file and the script` in `after`. `greet.js` and
  `long.txt` open with `lines` pressed, and the text size still reads
  `larger`.
- **Proof.** A snapshot of the two groups and a screenshot before and after
  `Larger`.

## Gotchas

- Reading `localStorage` through `browser_evaluate` is a second view of the
  side effect. Setting it that way proves nothing about the screen.
- The `Settings` tab replaces the comparison while it is open, so returning
  to `Local history` redraws every file in the newly chosen mode, selections
  intact. There is no way to change the setting with a file on screen.
