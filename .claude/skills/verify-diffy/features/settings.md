# Settings

`Settings` is the last tab in the top navigation, after `Local reviews`,
`Operations` and `Pull requests`. It holds display preferences that live in
the browser, not the repo, and apply everywhere at once.

## Sub-features

- `settings-tabs` is the top `navigation` of four buttons, each with a path
  of its own: `Local reviews` at `/reviews`, `Operations` at `/`, the landing
  screen, `Pull requests` at `/pulls` and `Settings` at `/settings`.
- `settings-text-size` is a `Text size` radio group, `Small`, `Standard`,
  `Large` and `Larger`, `Standard` by default. The choice lands on
  `document.documentElement.dataset.textSize` and scales the app's text.
- `settings-diff-mode` is a `Diffs start as` radio group,
  `Structural, with difftastic` by default or `Line by line`. It decides which
  side of each file's `Diff view` switch is pressed when the file first opens;
  see [the comparison pane](./comparison.md).
- `settings-diff-layout` is a `Diffs are laid out` radio group, `One column`
  by default or `Side by side`; see `diff-split` in
  [the comparison pane](./comparison.md).
- `settings-word-marks` is a `Structural diffs mark changed words` radio
  group: `Until half of a line changed`, `Until 70% of a line changed` (the
  default) or `Until 90% of a line changed`.
- `settings-persist` stores them in `localStorage` under `diffy.settings.v1`
  as `{"display": {"textSize", "diffMode", "diffLayout", "wordMarkLimit"}}`,
  so they survive a reload.

## How to get to it (user POV)

- Click `Settings` in the top navigation, or open `$URL/settings`.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.
- The MCP browser's `--isolated` profile starts with no `diffy.settings.v1`.

- **Defaults.** `browser_click` `nav button:text-is("Settings")`. The snapshot
  shows `Standard`, `Structural, with difftastic`, `One column` and
  `Until 70% of a line changed` checked.
- **Change them.** Click `radio "Larger"`, `radio "Line by line"` and
  `radio "Side by side"`. `browser_evaluate` reads
  `document.documentElement.dataset.textSize` as `larger`, and
  `localStorage["diffy.settings.v1"]` as
  `{"display":{"textSize":"larger","diffMode":"line","diffLayout":"split","wordMarkLimit":0.7}}`.
- **They apply.** Click `nav button:text-is("Operations")` and tick
  `fixture: edit the long file and the script`. `long.txt` opens with `lines`
  pressed, in two columns.
- **Proof.** A snapshot of the groups and a screenshot before and after
  `Larger`.

## Gotchas

- Reading `localStorage` through `browser_evaluate` is a second view of the
  side effect. Setting it that way proves nothing about the screen.
- The settings are the browser's, unlike review state. Clear
  `diffy.settings.v1` at the end of a drive so the next recipe in the same
  browser starts from the defaults.
