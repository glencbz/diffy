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

<<design-message>>

<<design-operation-picker>>

<<design-commit-label>>

<<design-comparison-header>>

<<design-review-state>>

<<design-commit-graph>>

<<design-interdiff-rows>>

<<design-diff-view>>

<<design-pull-state-chip>>

<<design-pull-list>>

<<design-pull-header>>

<<design-pull-timeline>>

<<design-responsive>>

<<design-dark>>
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

The ramps carry a dark end as well as a light one. A dark theme needs
surfaces below the darkest text grey and accents bright enough to read on
them, and those are shades of the same ramps rather than a second palette.

```css
/*| id: design-primitives
:root {
  --grey-800: #30363d;
  --grey-850: #21262d;
  --grey-950: #161b22;
  --grey-1000: #0d1117;

  --blue-400: #58a6ff;
  --blue-900: #0d2d5e;

  --green-300: #56d364;
  --green-900: #0f2a14;

  --red-400: #f85149;
  --red-900: #3d1618;

  --amber-400: #d29922;
  --amber-900: #3a2d0a;

  --purple-400: #bc8cff;
  --teal-400: #56d4dd;
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
  --review-open-surface: var(--red-100);
  --review-open-border: var(--red-200);

  --state-open: var(--green-600);
  --state-merged: var(--purple-600);
  --state-closed: var(--red-600);

  --endpoint-before: var(--amber-600);

  --graph-lane-0: var(--grey-900);
  --graph-lane-1: var(--blue-600);
  --graph-lane-2: var(--green-600);
  --graph-lane-3: var(--purple-600);
  --graph-lane-4: var(--amber-600);
  --graph-lane-5: var(--teal-600);
  --graph-lane-6: var(--red-600);
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
  --radius-large: 8px;

  --pane-picker-width: 25%;
  --pane-picker-min: 240px;
  --pane-list-width: 22%;
  --pane-list-min: 220px;
  --pane-commits-width: 260px;
  --gutter-width: 40px;
  --label-width: 56px;
  --border-width-accent: 3px;
}
```

## Shell

The window is a column: a tab strip that does not scroll, and under it
whichever screen is chosen. The body's default margin goes, because a
full-height app measured in `vh` inside an eight-pixel margin is sixteen
pixels taller than the window and scrolls when it should not. `min-height: 0` appears on every flex ancestor of
a scrolling pane because a flex item defaults to `min-height: auto`, which
refuses to shrink below its content and pushes the overflow out of the window
instead of into a scrollbar. It is the one piece of this file that is a
workaround rather than a decision.

```css
/*| id: design-shell
body {
  margin: 0;
}

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

## Message

Message is the app's one place for a status line, and the only variable in
it is whether the news is bad. `.message--error` is the single modifier that
recolours it, leaving the ordinary case as plain body text.

```css
/*| id: design-message
.message {
  padding: var(--space-5);
  color: var(--text);
}

.message--error {
  color: var(--danger);
}
```

## Operation picker

OperationPicker is a label wrapping a native `<select>`, so there is little
to style beyond lining the caption up with the control and letting the
select itself take the rest of the row.

```css
/*| id: design-operation-picker
.operation-picker {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.operation-picker__label {
  color: var(--text-faint);
}

.operation-picker__select {
  flex: 1;
  font: inherit;
}
```

## Commit label

A commit with no change id falls back to its short commit id rendered in
italic, so `.commit-label__id--synthetic` is the one modifier this label
needs; everything else about a commit's line is the same shape whether the
id is a change id or a stand-in for one.

```css
/*| id: design-commit-label
.commit-label__id {
  margin-right: var(--space-4);
  color: var(--text-faint);
}

.commit-label__id--synthetic {
  font-style: italic;
}

.commit-label__summary {
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-label__placeholder {
  color: var(--text-ghost);
}
```

## Comparison header

ComparisonHeader stacks the before and after rows over a strip of review
actions, and the caption column is a fixed width so "before" and "after"
line up with each other no matter how long the commit summary next to them
runs.

```css
/*| id: design-comparison-header
.comparison-header {
  padding: var(--space-4) var(--space-5);
  background: var(--surface-sunken);
  border-bottom: 1px solid var(--border);
}

.comparison-header__row {
  display: flex;
  white-space: nowrap;
  overflow: hidden;
}

.comparison-header__caption {
  width: var(--label-width);
  flex: none;
  color: var(--text-faint);
}

.comparison-header__unavailable {
  font-style: italic;
  color: var(--text-ghost);
}

.comparison-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.comparison-header__mark-seen {
  font: inherit;
}
```

## Review state

A comment or a comparison row is always in one of the same three states —
still open, resolved, or stale against a rewrite since it was written — and
`--review-open`, `--review-resolved`, and `--review-stale` are the one set
of roles that both the tone chip on a comparison header and the accent on a
comment thread read from. A resolved comment and a resolved row share a
colour without either file naming it.

```css
/*| id: design-review-state
.review-chip {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-large);
  font-size: var(--text-size-small);
}

.review-chip--resolved {
  background: var(--review-seen-surface);
  color: var(--review-resolved);
  border: 1px solid var(--review-seen-border);
}

.review-chip--stale {
  background: var(--review-changed-surface);
  color: var(--review-stale);
  border: 1px solid var(--review-changed-border);
}

.review-chip--open {
  background: var(--review-open-surface);
  color: var(--review-open);
  border: 1px solid var(--review-open-border);
}

.comment-thread {
  padding: var(--space-3) var(--space-4);
  margin: var(--space-2) var(--space-4);
  border-left: var(--border-width-accent) solid var(--review-open);
}

.comment-thread--resolved {
  border-left-color: var(--review-resolved);
  opacity: 0.72;
}

.comment-thread__meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-faint);
}

.comment-thread__stale {
  color: var(--review-stale);
}
```

## Commit graph

CommitGraph reads its edge and node colours off a seven-step lane ramp
instead of picking one by hand: a lane's index selects one of the
`--graph-lane-N` roles as `color`, and the line and circle underneath both
draw in `currentColor`, so an edge always agrees with the node it meets.

The gutter is the one width this file does not set. It depends on how many
lanes a history happens to use, and the `<svg>` already carries that number
in its own `width` attribute, so a rule here would be a second copy of a
figure the markup has. The row height is the same story in reverse: the
graphic is drawn against a row height the component computes its geometry
from, and the row takes its height from the graphic rather than from a
length declared here that could drift away from the arithmetic.

```css
/*| id: design-commit-graph
.commit-graph__row {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0;
  border: none;
  white-space: nowrap;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
}

.commit-graph__row--selected {
  background: var(--surface-selected);
}

.commit-graph__row--interactive {
  cursor: pointer;
}

.commit-graph__gutter {
  flex: none;
}

.commit-graph__edge {
  stroke: currentColor;
}

.commit-graph__node {
  stroke: currentColor;
  fill: currentColor;
}

.commit-graph__node--merge {
  fill: var(--surface);
}

.commit-graph__lane--0 {
  color: var(--graph-lane-0);
}

.commit-graph__lane--1 {
  color: var(--graph-lane-1);
}

.commit-graph__lane--2 {
  color: var(--graph-lane-2);
}

.commit-graph__lane--3 {
  color: var(--graph-lane-3);
}

.commit-graph__lane--4 {
  color: var(--graph-lane-4);
}

.commit-graph__lane--5 {
  color: var(--graph-lane-5);
}

.commit-graph__lane--6 {
  color: var(--graph-lane-6);
}
```

## Interdiff rows

A comparison with no files still renders, and the placeholder saying so
gets the same muted italic treatment every empty state in the app uses.

```css
/*| id: design-interdiff-rows
.interdiff-empty {
  padding: var(--space-5);
  font-style: italic;
  color: var(--text-muted);
}
```

## Diff view

A patch line's colour is chosen from the same fixed set a unified diff
always has — added, removed, a hunk header, or file-level meta — so DiffView
maps a line's text to one of four modifier classes instead of a lookup
table of colours, and `--diff-added`, `--diff-removed`, `--diff-hunk`, and
`--diff-meta` are the only place those colours live.

```css
/*| id: design-diff-view
.diff-view {
  padding: var(--space-5);
}

.diff-file {
  margin-bottom: var(--space-6);
  border: 1px solid var(--border);
}

.diff-file__header {
  padding: var(--space-2) var(--space-4);
  font-weight: bold;
  background: var(--surface-raised);
}

.diff-file__status {
  margin-right: var(--space-4);
  color: var(--text-muted);
}

.diff-file__binary {
  padding: var(--space-4);
  font-style: italic;
  color: var(--text-muted);
}

.diff-file__patch {
  margin: 0;
  padding: var(--space-4);
  overflow-x: auto;
}

.diff-line {
  display: flex;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
}

.diff-line--interactive {
  cursor: pointer;
}

.diff-line__gutter {
  width: var(--gutter-width);
  flex: none;
  margin-right: var(--space-4);
  text-align: right;
  color: var(--text-ghost);
  user-select: none;
}

.diff-line__text--meta {
  color: var(--diff-meta);
}

.diff-line__text--hunk {
  color: var(--diff-hunk);
}

.diff-line__text--added {
  color: var(--diff-added);
}

.diff-line__text--removed {
  color: var(--diff-removed);
}

.comment-composer {
  padding: var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--surface-sunken);
}

.comment-composer__line {
  margin-bottom: var(--space-2);
  color: var(--text-faint);
}

.comment-composer__input {
  width: 100%;
  font: inherit;
}

.comment-composer__actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
```

## Pull request state chip

A pull request is open, merged, or closed and nothing else, so
PullStateChip is `.chip` plus one modifier per state rather than a colour
keyed by string. `--state-open`, `--state-merged`, and `--state-closed` are
the only place those three colours are written down.

```css
/*| id: design-pull-state-chip
.chip {
  flex: none;
  padding: 0 var(--space-3);
  border-radius: var(--radius);
  color: var(--text-inverse);
  font-size: var(--text-size-small);
}

.chip--open {
  background: var(--state-open);
}

.chip--merged {
  background: var(--state-merged);
}

.chip--closed {
  background: var(--state-closed);
}
```

## Pull request list

PullList renders each pull request as a full-width button standing in for
a row, and the selected one takes the same selection colour a picked commit
gets in the graph.

```css
/*| id: design-pull-list
.pull-list__item {
  display: block;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
}

.pull-list__item--selected {
  background: var(--surface-selected);
}

.pull-list__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.pull-list__number {
  color: var(--text-faint);
}

.pull-list__title {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pull-list__base {
  color: var(--text-faint);
}
```

## Pull request header

PullHeader is a strip of small facts about a pull request, and the number,
the base branch, and the author share one muted style since none of them
outranks the others.

```css
/*| id: design-pull-header
.pull-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
}

.pull-header__title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pull-header__meta {
  color: var(--text-faint);
}

.pull-header__link {
  color: var(--accent);
}
```

## Pull request timeline

A version chip on the timeline is picked as the before end, the after end,
or neither, which is a fixed set of three and becomes a modifier rather
than a colour computed in the component. `--endpoint-before` is the one new
role this adds; the after end reuses `--accent`, the same blue used for the
current selection everywhere else in the app.

```css
/*| id: design-pull-timeline
.pull-timeline {
  flex: none;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border);
}

.pull-timeline__row {
  display: flex;
  align-items: stretch;
  gap: var(--space-3);
  overflow-x: auto;
}

.pull-timeline__caption {
  margin: var(--space-3) 0 0;
  color: var(--text-faint);
}

.pull-chip {
  flex: none;
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: inherit;
  background: var(--surface);
}

.pull-chip--before {
  border-color: var(--endpoint-before);
  color: var(--endpoint-before);
  background: var(--review-unseen-surface);
}

.pull-chip--after {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--review-unseen-surface);
}

.pull-chip__caption {
  display: block;
  font-weight: bold;
}

.pull-chip__detail {
  display: block;
  color: var(--text-faint);
  font-size: var(--text-size-small);
}
```

## Responsiveness

A window narrower than about three comfortable columns gets narrower columns,
and a window narrower than about two stops being columns at all. The first
breakpoint is an edit to the metrics layer and nothing else: rebinding the
minimum widths retunes every pane at once, because no view and no component
rule holds a width of its own.

The second breakpoint has to change the layout rather than a length, so it
turns the pane row into a stack and caps the pickers at a fraction of the
viewport so the diff still has somewhere to be. That is the only rule in the
file that overrides a component, and it reads as one because it is grouped
here rather than left next to the pane it contradicts.

```css
/*| id: design-responsive
@media (max-width: 1100px) {
  :root {
    --pane-picker-min: 180px;
    --pane-list-min: 160px;
    --pane-commits-width: 200px;
  }
}

@media (max-width: 820px) {
  .panes {
    flex-direction: column;
    overflow: auto;
  }

  .pane {
    width: auto;
    min-width: 0;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .pane--picker,
  .pane--list,
  .pane--commits {
    width: auto;
    min-width: 0;
    max-height: 30vh;
  }

  .pane--diff {
    flex: 1 0 auto;
    border-bottom: none;
  }
}
```

## Dark theme

Dark mode rebinds roles and touches nothing else. No component rule, no
breakpoint, and no view changes, which is the claim the layering makes and
the reason it is worth the indirection: the whole theme is the block below.

The diff and review colours brighten rather than swap. A patch reads the way
a patch reads everywhere, so added stays green and removed stays red, at a
lightness that survives a dark surface.

```css
/*| id: design-dark
@media (prefers-color-scheme: dark) {
  :root {
    --surface: var(--grey-1000);
    --surface-raised: var(--grey-950);
    --surface-sunken: var(--grey-850);
    --surface-selected: var(--blue-900);

    --border: var(--grey-800);
    --border-subtle: var(--grey-850);

    --text: var(--grey-100);
    --text-muted: var(--grey-500);
    --text-faint: var(--grey-600);
    --text-ghost: var(--grey-700);
    --text-inverse: var(--grey-1000);

    --accent: var(--blue-400);
    --danger: var(--red-400);

    --diff-added: var(--green-300);
    --diff-removed: var(--red-400);
    --diff-meta: var(--grey-600);
    --diff-hunk: var(--blue-400);

    --review-open: var(--red-400);
    --review-resolved: var(--green-300);
    --review-stale: var(--amber-400);
    --review-seen-surface: var(--green-900);
    --review-seen-border: var(--green-600);
    --review-changed-surface: var(--amber-900);
    --review-changed-border: var(--amber-600);
    --review-open-surface: var(--red-900);
    --review-open-border: var(--red-600);
    --review-unseen-surface: var(--blue-900);

    --state-open: var(--green-300);
    --state-merged: var(--purple-400);
    --state-closed: var(--red-400);

    --endpoint-before: var(--amber-400);

    --graph-lane-0: var(--grey-100);
    --graph-lane-1: var(--blue-400);
    --graph-lane-2: var(--green-300);
    --graph-lane-3: var(--purple-400);
    --graph-lane-4: var(--amber-400);
    --graph-lane-5: var(--teal-400);
    --graph-lane-6: var(--red-400);
  }
}
```
