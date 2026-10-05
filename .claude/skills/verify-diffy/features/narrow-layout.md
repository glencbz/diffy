# Narrow layout

Below 1000 pixels wide, the Operations screen stops drawing its graphs and the
diff side by side and shows one pane at a time, chosen from a row of pane tabs.
This is the layout a phone gets.

## Sub-features

- `narrow-tabs` adds a `navigation` under the top one: a tab per graph,
  captioned with what it holds (`nothing yet`, `1 commit`, `N commits`), and
  `diff`. The lone graph's tab is `commits`; with the interdiff open the
  graph tabs are `before` and `after`. The highlighted tab is the pane on
  screen; the tabs carry no pressed state in the ARIA tree.
- `narrow-rows` shortens commit rows, dropping the author email, so a row's
  accessible name no longer contains it.
- `narrow-navigator` moves the file navigator to a bar along the bottom of the
  screen; see [file navigation](./file-navigation.md).

## How to get to it (user POV)

- Open diffy on a phone, or narrow the window below 1000 pixels.

## Driving it with Playwright MCP

Preconditions:

- `verify.sh doctor` reports `OK`.

- **Narrow the page.** Tick `fixture: edit the long file and the script` at
  the default width, then `browser_resize` to `412` by `900`. The second
  `navigation` holds `commits 1 commit` and `diff`, over one column of
  commit rows.
- **Switch panes.** Click `nav button:has-text("diff")`. The comparison fills
  the screen, and the navigator reading `1 / 3 bun.lock` sits at the bottom.
- **Widen it back.** `browser_resize` to `1280` by `720` restores the graph
  beside the diff.
- **Proof.** An unnamed viewport screenshot on the `diff` pane; the bottom bar
  is only visible there.

## Gotchas

- A row selector that includes the email fails in this layout. Match rows on
  their description, as the other recipes do.
- `.pane:has(h2:text-is("after"))` still addresses a graph with the interdiff
  open, but only the chosen pane is visible, so click its tab before clicking
  inside it.
- `browser_resize` lasts for the rest of the browser's life. Widen it again
  before the next recipe, or every later screenshot is a phone one.
