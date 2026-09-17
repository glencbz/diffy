# Design system

Every colour, edge, and gap in the app comes from one stylesheet, and the
views name what they want rather than what it looks like. A view asks for
`--text-muted`; it does not ask for `#666`. That indirection is the whole
point: the question "what grey do captions use" has one answer in one file,
and changing it changes every caption at once.

Before this, styling lived in `style={{ ... }}` objects next to the markup.
Two dozen hex literals were spread over fifteen view files, `#ccc` appearing
a dozen times with nothing to say whether two uses meant the same thing. The
deeper problem was not repetition. An inline style cannot hold a media query
or a pseudo-class, so the app had no way to express "narrower than this, lay
the panes out differently" at all. Responsiveness was unreachable, not
unfinished.

## Layers

The stylesheet is read top to bottom as four layers, and each one may only
name the layer above it.

**Primitives** are the raw ramps, named for what they are. `--grey-300` says
nothing about where it is used. Changing one reshades the palette.

**Roles** map a primitive to a job. `--border` is `--grey-300`. This is the
only layer a component is allowed to name, which is what lets the palette and
the meaning move independently. Retheming the app is an edit to this layer;
so is dark mode, which rebinds roles and leaves every rule below untouched.

**Metrics** are the tunable lengths: the spacing step, the type sizes, and
the widths of the columns. Responsiveness is an edit to this layer, because a
breakpoint that only rebinds `--pane-picker-width` cannot accidentally change
a colour.

**Components** are the classes the views use. They name roles and metrics and
never a primitive, so a component rule contains no literal a reviewer has to
decode.

A change therefore has one address. A new brand colour is a primitive. A
caption that should be darker is a role. A column that should be wider on
large screens is a metric under a breakpoint. Nothing else needs reading.

## Composition

The stylesheet is assembled in layer order, so a rule can only be overridden
by a rule from a layer below it and the cascade agrees with the layering.

```css
/*| id: stylesheet
/*| file: src/frontend/styles.css
<<design-primitives>>

<<design-roles>>

<<design-metrics>>

<<design-shell>>

<<design-panes>>
```

## Primitives

The ramps are the colours the app already used, sorted and named by
lightness. Nothing here is new; the values are the ones the inline styles
had, collected so that two uses of the same grey are visibly the same grey.

```css
/*| id: design-primitives
:root {
  --grey-0: #ffffff;
  --grey-50: #fafafa;
  --grey-100: #f0f0f0;
  --grey-200: #eeeeee;
  --grey-300: #cccccc;
  --grey-500: #999999;
  --grey-600: #888888;
  --grey-700: #666666;
  --grey-900: #333333;

  --blue-100: #f4f8ff;
  --blue-200: #d0e4ff;
  --blue-600: #0969da;

  --green-100: #edf7ed;
  --green-200: #a8d5a8;
  --green-400: #63b363;
  --green-600: #1a7f37;
  --green-800: #2b6a2b;

  --red-100: #fdecec;
  --red-200: #e6a8a8;
  --red-600: #cf222e;
  --red-800: #a01b1b;

  --amber-100: #fdf5e3;
  --amber-200: #e6c98a;
  --amber-600: #bf8700;
  --amber-800: #8a5a00;

  --purple-600: #8250df;
  --teal-600: #1b7c83;
}
```

## Roles

A role is a sentence about the interface. `--surface-raised` is the shade a
header sits on, and the fact that it is currently the same grey as a tab
strip is a decision recorded here rather than a coincidence repeated in two
files.

The diff and review roles are kept apart from the general ones on purpose.
Added-line green and open-comment red are the app's vocabulary, not its
chrome, and a theme that wanted a colder interface would still want the
patch to read the way a patch reads everywhere else.

```css
/*| id: design-roles
:root {
  --surface: var(--grey-0);
  --surface-raised: var(--grey-100);
  --surface-sunken: var(--grey-50);
  --surface-selected: var(--blue-200);

  --border: var(--grey-300);
  --border-subtle: var(--grey-200);

  --text: var(--grey-900);
  --text-muted: var(--grey-700);
  --text-faint: var(--grey-600);
  --text-ghost: var(--grey-500);
  --text-inverse: var(--grey-0);

  --accent: var(--blue-600);
  --danger: var(--red-600);

  --diff-added: var(--green-600);
  --diff-removed: var(--red-600);
  --diff-meta: var(--grey-700);
  --diff-hunk: var(--blue-600);

  --review-open: var(--red-800);
  --review-resolved: var(--green-400);
  --review-stale: var(--amber-800);
  --review-seen-surface: var(--green-100);
  --review-seen-border: var(--green-200);
  --review-changed-surface: var(--amber-100);
  --review-changed-border: var(--amber-200);
  --review-unseen-surface: var(--blue-100);

  --state-open: var(--green-600);
  --state-merged: var(--purple-600);
  --state-closed: var(--red-600);
}
```

## Metrics

Spacing is a step scale rather than the free-for-all it replaces. The inline
styles used 3, 4, 5, 6, 8, 10, 12, 14, and 16 pixels, which is nine values
for about four intentions. Each one is snapped to the nearest step, so a few
gaps shift by a pixel or two and every gap afterwards is a choice between
named sizes instead of a typed-in number.

The column widths are metrics rather than numbers buried in a layout
component, and that is what makes the breakpoints below a two-line change.

```css
/*| id: design-metrics
:root {
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-7: 24px;

  --font-mono: ui-monospace, monospace;
  --text-size: 13px;
  --text-size-small: 11px;

  --radius: 3px;

  --pane-picker-width: 25%;
  --pane-picker-min: 240px;
  --pane-list-width: 22%;
  --pane-list-min: 220px;
  --pane-commits-width: 260px;
  --gutter-width: 40px;
}
```

## Shell

The window is a column: a tab strip that does not scroll, and under it
whichever screen is chosen. `min-height: 0` appears on every flex ancestor of
a scrolling pane because a flex item defaults to `min-height: auto`, which
refuses to shrink below its content and pushes the overflow out of the window
instead of into a scrollbar. It is the one piece of this file that is a
workaround rather than a decision.

```css
/*| id: design-shell
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: var(--font-mono);
  font-size: var(--text-size);
  color: var(--text);
  background: var(--surface);
}

.tabs {
  display: flex;
  flex: none;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: var(--space-3) var(--space-6);
  font: inherit;
  color: var(--text);
  cursor: pointer;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
}

.tab:hover {
  background: var(--surface-sunken);
}

.tab--current {
  font-weight: bold;
  color: var(--accent);
  border-bottom-color: var(--accent);
}
```

## Panes

Every screen is the same shape: columns that scroll on their own, divided by
a single-pixel rule. `.panes` is that row, `.pane` is a column, and the
modifiers say only how wide. Nothing about a pane's width lives in the view
that renders it.

```css
/*| id: design-panes
.panes {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  flex: none;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.pane__header {
  flex: none;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  font: inherit;
  font-weight: bold;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}

.pane__body {
  overflow: auto;
}

.pane--picker {
  width: var(--pane-picker-width);
  min-width: var(--pane-picker-min);
}

.pane--list {
  width: var(--pane-list-width);
  min-width: var(--pane-list-min);
  overflow: auto;
}

.pane--commits {
  width: var(--pane-commits-width);
  overflow: auto;
}

.pane--main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border-right: none;
}

.pane--diff {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border-right: none;
}
```
