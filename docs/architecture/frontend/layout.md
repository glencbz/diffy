# Layout

How both screens arrange a picker beside a wide diff, and what they do in a
window with no room for columns.

## Review panes

The local screen shows one commit graph and the diff; `interdiff` opens the
before graph as a third column on the left, each picker captioned with its
side. An interdiff can instead sit in [one graph](combined-graph.md), a
single column holding both pickers above it, beside the same diff. The lone
graph and the after graph are the same side, so ticks carry over, but every
graph column keeps its width under a key of its own.

Under 1000px a tab list shows one pane at a time instead of stacking, since
stacked pickers fill a phone before the diff starts. In a two-graph interdiff
the graphs then occupy the same rectangle, so flipping between `before` and
`after` shows the change in place; that is why the tabs sit above `.panes`,
where nothing between them moves during a flip. Picking a commit does not
switch tabs, which would cost the reader that flip. Each tab shows how many
commits its side has picked, since an off-screen pane's state is otherwise
invisible; the one-graph column's tab counts both sides.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSize, Splitter } from "./Splitter";

export type Pane = "before" | "after" | "combined" | "diff";

/** Which columns the screen draws: the lone graph, an interdiff on two
 *  graphs, or an interdiff on one. */
export type PaneLayout = "log" | "split" | "combined";

const PANES: Record<PaneLayout, Pane[]> = {
  log: ["after", "diff"],
  split: ["before", "after", "diff"],
  combined: ["combined", "diff"],
};

/** What each pane is called. A graph with no second graph beside it holds
 *  "commits"; "after" alone would name a comparison nobody asked for. */
function caption(pane: Pane, layout: PaneLayout): string {
  if (pane === "combined" || (pane === "after" && layout === "log")) {
    return "commits";
  }
  return pane;
}

export function ReviewPanes({
  before,
  after,
  combined,
  diff,
  layout,
  showing,
  onShow,
  selected,
  sizes,
  onResize,
}: {
  before: ReactNode;
  after: ReactNode;
  /** The one-graph interdiff's column, drawn only in that layout. */
  combined: ReactNode;
  diff: ReactNode;
  layout: PaneLayout;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
  sizes: PaneSizes;
  onResize: (pane: PaneKey, size: number | null) => void;
}) {
  const panes = PANES[layout];
  // A pane the layout lacks falls back to the graph beside the diff.
  const current = panes.includes(showing)
    ? showing
    : (panes[panes.length - 2] as Pane);
  const afterKey: PaneKey = layout === "log" ? "local-log" : "local-after";

  return (
    <>
      <PaneTabs
        panes={panes}
        layout={layout}
        showing={current}
        onShow={onShow}
        selected={selected}
      />
      <div className="panes panes--review">
        {layout === "split" && (
          <PickerColumn
            pane="before"
            caption={caption("before", layout)}
            showing={current}
            sizeKey="local-before"
            size={sizes["local-before"] ?? null}
            onResize={(size) => onResize("local-before", size)}
          >
            {before}
          </PickerColumn>
        )}
        {layout === "combined" ? (
          <PickerColumn
            pane="combined"
            caption={caption("combined", layout)}
            showing={current}
            sizeKey="local-combined"
            size={sizes["local-combined"] ?? null}
            onResize={(size) => onResize("local-combined", size)}
          >
            {combined}
          </PickerColumn>
        ) : (
          <PickerColumn
            pane="after"
            caption={caption("after", layout)}
            showing={current}
            sizeKey={afterKey}
            size={sizes[afterKey] ?? null}
            onResize={(size) => onResize(afterKey, size)}
          >
            {after}
          </PickerColumn>
        )}
        <div className={paneClass("pane pane--diff", current === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  panes,
  layout,
  showing,
  onShow,
  selected,
}: {
  panes: Pane[];
  layout: PaneLayout;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <nav className="pane-tabs">
      {panes.map((pane) => (
        <button
          type="button"
          key={pane}
          onClick={() => onShow(pane)}
          className={
            pane === showing ? "pane-tab pane-tab--current" : "pane-tab"
          }
          aria-current={pane === showing}
        >
          <span className="pane-tab__caption">{caption(pane, layout)}</span>
          {pane !== "diff" && (
            <span className="pane-tab__picked">
              {pane === "combined"
                ? `before: ${picked(selected.before)}, after: ${picked(selected.after)}`
                : picked(selected[pane])}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

function picked(commits: number): string {
  if (commits === 0) return "nothing yet";
  return commits === 1 ? "1 commit" : `${commits} commits`;
}

function PickerColumn({
  pane,
  caption,
  showing,
  sizeKey,
  size,
  onResize,
  children,
}: {
  pane: "before" | "after" | "combined";
  caption: string;
  showing: Pane;
  sizeKey: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  children: ReactNode;
}) {
  // A column beside another graph is narrow; a graph on its own is wide.
  const width =
    sizeKey === "local-before" || sizeKey === "local-after"
      ? "pane--picker"
      : "pane--log";
  const sized = size === null ? `pane ${width}` : `pane ${width} pane--sized`;
  return (
    <>
      <div
        className={paneClass(sized, pane === showing)}
        style={paneSize(size)}
      >
        <h2 className="pane__header">{caption}</h2>
        <div className="pane__body">{children}</div>
      </div>
      <Splitter
        pane={sizeKey}
        size={size}
        onResize={onResize}
        label={`resize the ${caption} column`}
      />
    </>
  );
}

function paneClass(pane: string, showing: boolean): string {
  return showing ? `${pane} pane--showing` : pane;
}
```

The tab list is fully styled in `components` and switched on only by the
narrow rule; its rows run down the window, marked current on the left edge.

```css
/*| id: design-pane-tabs
@layer components {
  .pane-tabs {
    display: none;
    flex: none;
    flex-direction: column;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .pane-tab {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) var(--space-6);
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    border-left: var(--border-width-accent) solid transparent;
  }

  .pane-tab:hover {
    background: var(--surface-sunken);
  }

  .pane-tab--current {
    font-weight: bold;
    color: var(--accent);
    border-left-color: var(--accent);
  }

  .pane-tab__picked {
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }
}
```

## Pull request panes

The pull request screen nests: the list against everything else, and inside
that the header and picker over [a drawer of commits](#the-commit-drawer) and
the diff.

```tsx
//| id: frontend-view-pull-panes
//| file: src/frontend/views/PullPanes/PullPanes.tsx
import type { ReactNode } from "react";
import type { PullChoice } from "../../model/place";
import type { PullSummary } from "../../model/pull";
import { PullStateChip } from "../PullStateChip";
import { PullList } from "./PullList";

export function PullPanes({
  choice,
  onOpen,
  onDismiss,
  pulls,
  onSelect,
  review,
}: {
  choice: PullChoice;
  onOpen: () => void;
  onDismiss: () => void;
  pulls: PullSummary[];
  onSelect: (number: number) => void;
  review: ReactNode;
}) {
  return (
    <>
      {choice.phase !== "browsing" && (
        <button type="button" onClick={onOpen} className="pull-bar">
          <span className="pull-bar__number">#{choice.pull.number}</span>
          <PullStateChip state={choice.pull.state} />
          <span className="pull-bar__title">{choice.pull.title}</span>
        </button>
      )}
      <div className={`panes panes--${choice.phase}`}>
        {choice.phase === "reviewing" && (
          <button
            type="button"
            aria-label="show the pull request list"
            onClick={onOpen}
            className="pull-rail"
          >
            pull requests
          </button>
        )}
        <div className="pane pane--list">
          {choice.phase === "picking" && (
            <header className="pull-sheet__header">
              <span className="pull-sheet__caption">pull requests</span>
              <button
                type="button"
                onClick={onDismiss}
                className="pull-sheet__close"
              >
                close
              </button>
            </header>
          )}
          <PullList
            pulls={pulls}
            selected={choice.phase === "browsing" ? null : choice.pull.number}
            onSelect={onSelect}
          />
        </div>
        <div className="pane pane--main">{review}</div>
      </div>
      {choice.phase === "picking" && (
        <button
          type="button"
          aria-label="dismiss the pull request list"
          onClick={onDismiss}
          className="pull-scrim"
        />
      )}
    </>
  );
}
```

### Reviewing a pull request

```tsx
//| id: frontend-view-pull-review-panes
//| file: src/frontend/views/PullReviewPanes/PullReviewPanes.tsx
import { type ReactNode, useState } from "react";
import { paneSize, Splitter } from "../Splitter";
import { DrawerBar } from "./DrawerBar";

/** Where the reader is in the stack: the row picked, if any, out of how
 *  many, and a line naming it. */
export interface StackPosition {
  index: number | null;
  count: number;
  summary: string;
}

export function PullReviewPanes({
  header,
  picker,
  commits,
  diff,
  position,
  onStep,
  size,
  onResize,
}: {
  /** The series screen's header, which a pull request and a local review
   *  each fill in for themselves. */
  header: ReactNode;
  picker: ReactNode;
  commits: ReactNode;
  diff: ReactNode;
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
  size: number | null;
  onResize: (size: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {header}
      <div className="pull-toolbar">{picker}</div>
      <div className="panes panes--drawer">
        <DrawerBar
          position={position}
          onStep={onStep}
          open={open}
          onToggle={() => setOpen((now) => !now)}
        />
        {open && (
          <>
            <div
              className={
                size === null
                  ? "pane pane--commits"
                  : "pane pane--commits pane--sized"
              }
              style={paneSize(size)}
            >
              {commits}
            </div>
            <Splitter
              pane="pull-commits"
              size={size}
              onResize={onResize}
              label="resize the commit list"
            />
          </>
        )}
        <div className="pane pane--diff">{diff}</div>
      </div>
    </>
  );
}
```

## The commit drawer

The commits sit above the diff, full width, because the paired graph's two
lanes of subjects would truncate to stubs in a column beside it. They trade
height instead, set by the [splitter](#resizing-a-pane) under the drawer.

Until the reader sets that height, the drawer is as tall as its rows, capped
at `--pane-drawer-height`. A fixed share of the window would leave an empty
band under the list on every short stack, which is most pull requests.

The comparison picker and the review marks share one toolbar,
`.pull-toolbar`, which wraps on a narrow window. As two bands they held a
row of controls and a row of nearly nothing.

The drawer folds to a bar that keeps where the reader is in the stack and a
stepper to the previous or next row; the rest of the bar is one fold button,
so a press on an arrow never also folds. It opens on every visit, since a
pull request opened with its commit list hidden hides the first thing a new
reader needs; only its height is kept.

```tsx
//| id: frontend-view-drawer-bar
//| file: src/frontend/views/PullReviewPanes/DrawerBar.tsx
import type { StackPosition } from "./PullReviewPanes";

export function DrawerBar({
  position: { index, count, summary },
  onStep,
  open,
  onToggle,
}: {
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="drawer-bar">
      <div className="drawer-bar__stepper">
        <button
          type="button"
          aria-label="previous commit"
          disabled={index === null || index === 0}
          onClick={() => onStep(-1)}
          className="drawer-bar__step"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="next commit"
          disabled={index === null ? count === 0 : index >= count - 1}
          onClick={() => onStep(1)}
          className="drawer-bar__step"
        >
          ›
        </button>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="drawer-bar__toggle"
      >
        <span className="drawer-bar__position">
          {index === null ? commitCount(count) : `${index + 1} of ${count}`}
        </span>
        <span className="drawer-bar__summary">{summary}</span>
        <span className="drawer-bar__fold">
          {open ? "▾ fold" : "▸ show all"}
        </span>
      </button>
    </div>
  );
}

function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
```

```css
/*| id: design-commit-drawer
@layer components {
  .panes--drawer {
    flex-direction: column;
  }

  .drawer-bar {
    display: flex;
    flex: none;
    align-items: stretch;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .drawer-bar__stepper {
    display: flex;
    flex: none;
    margin: var(--space-2) 0 var(--space-2) var(--space-4);
  }

  .drawer-bar__step {
    min-width: 28px;
    padding: 0 var(--space-4);
    font: inherit;
    font-weight: bold;
    color: var(--text);
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .drawer-bar__step:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .drawer-bar__step:last-child {
    border-left: none;
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .drawer-bar__step:hover:not(:disabled) {
    color: var(--accent);
    background: var(--surface-sunken);
  }

  .drawer-bar__step:disabled {
    color: var(--text-ghost);
    cursor: default;
  }

  .drawer-bar__toggle {
    display: flex;
    flex: 1;
    gap: var(--space-4);
    align-items: center;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .drawer-bar__toggle:hover {
    background: var(--surface-sunken);
  }

  .drawer-bar__position {
    flex: none;
    font-weight: bold;
  }

  .drawer-bar__summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .drawer-bar__fold {
    flex: none;
    color: var(--accent);
  }

  .pull-toolbar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }
}
```

```css
/*| id: design-commit-drawer
@layer components-narrow {
  @media (max-width: 1000px) {
    .drawer-bar__step {
      min-width: 44px;
      min-height: 44px;
    }

    .panes--drawer .splitter--y::before {
      inset: calc(-1 * var(--space-4)) 0;
    }
  }
}
```

On a wide screen each drawer row is one line, the id, the subject, then who
and when, since the drawer has the window's width and the subject is what a
reader scans for. A phone keeps the two-line row, which wraps a long subject
rather than cutting it off.

```css
/*| id: design-commit-drawer-rows
/* After the graph's own rules in the stylesheet, so these win by order as
   well as by specificity. */
@layer components {
  @media (min-width: 1001px) {
    .pane--commits .commit-graph__row {
      min-height: calc(28 / 12 * 1em);
    }

    .pane--commits .commit-label {
      flex-direction: row;
      align-items: baseline;
      justify-content: flex-start;
      gap: var(--space-3);
      overflow: hidden;
    }

    /* Lets the meta line's parts and the subject be ordered as siblings,
       each still inheriting the meta line's small muted text. */
    .pane--commits .commit-label__meta {
      display: contents;
    }

    .pane--commits .commit-label__summary {
      flex: 0 1 auto;
      order: 1;
      min-width: 0;
    }

    .pane--commits .commit-label__author,
    .pane--commits .commit-label__time,
    .pane--commits .commit-ref {
      order: 2;
    }
  }
}
```

## The list as a sheet

On a phone the list is modal: with nothing chosen it is the window, choosing
collapses it to a bar naming the choice, and pressing the bar brings it back
as a sheet over the review. The local screen's tab list does not fit here:
choosing a pull request happens once, so a standing control for it spends
width on an answered question. `PullChoice` is one value with three phases,
since a flag beside a summary could say "sheet open over nothing". The scrim
is a `<button>` so a keyboard can reach it.

```css
/*| id: design-pull-sheet
@layer components {
  .pull-bar {
    display: none;
    flex: none;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: var(--surface-raised);
    border: none;
    border-bottom: 1px solid var(--border);
  }

  .pull-bar__number {
    color: var(--text-faint);
  }

  .pull-bar__title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pull-sheet__header {
    display: flex;
    position: sticky;
    top: 0;
    flex: none;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .pull-sheet__caption {
    font-weight: bold;
  }

  .pull-sheet__close {
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .pull-scrim {
    display: none;
    position: fixed;
    z-index: 1;
    inset: 0;
    padding: 0;
    border: none;
    background: color-mix(in srgb, var(--text) 35%, transparent);
  }
}
```

```css
/*| id: design-pull-sheet
@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-bar {
      display: flex;
    }

    .pull-scrim {
      display: block;
    }

    .pull-rail {
      display: none;
    }

    .panes--browsing .pane--main {
      display: none;
    }

    .panes--browsing .pane--list {
      flex: 1;
    }

    .panes--reviewing .pane--list,
    .panes--picking .pane--list {
      display: flex;
      position: fixed;
      z-index: 2;
      right: 0;
      bottom: 0;
      left: 0;
      height: 85dvh;
      background: var(--surface);
      border-top: 1px solid var(--border);
      border-bottom: none;
      border-radius: var(--radius-large) var(--radius-large) 0 0;
      /* Slides rather than display: none, so there is something to animate.
         visibility leaves the tab order and holds the sheet visible until
         the slide out ends. 85dvh leaves a strip of the review showing, which
         says the list is over it, not instead of it. */
      visibility: hidden;
      transform: translateY(100%);
      transition:
        transform 0.2s ease,
        visibility 0.2s;
    }

    .panes--picking .pane--list {
      visibility: visible;
      transform: translateY(0);
    }
  }
}
```

## The list as a column

A wide window divides by the same three phases: browsing shows the list as a
column, choosing folds it to a rail on the left edge, and pressing the rail
reopens the column beside the review. A rail rather than a bar, since the
review's header already names the pull request.

```css
/*| id: design-pull-sheet
@layer components {
  .pull-rail {
    display: flex;
    flex: none;
    align-items: center;
    padding: var(--space-5) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    writing-mode: vertical-rl;
    background: var(--surface-raised);
    border: none;
    border-right: 1px solid var(--border);
  }

  .pull-rail:hover {
    color: var(--accent);
    background: var(--surface-sunken);
  }

  .panes--reviewing .pane--list {
    display: none;
  }
}
```

## The pane rules

`.panes` is a row of independently scrolling `.pane` columns; a size the
reader dragged arrives as `--pane-size`.

```css
/*| id: design-panes
@layer components {
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
    width: var(--pane-size, var(--pane-picker-width));
    min-width: var(--pane-picker-min);
  }

  .pane--log {
    width: var(--pane-size, var(--pane-log-width));
    min-width: var(--pane-picker-min);
  }

  .pane--list {
    width: var(--pane-list-width);
    min-width: var(--pane-list-min);
    overflow: auto;
  }

  .pane--commits {
    height: var(--pane-size, auto);
    max-height: var(--pane-size, var(--pane-drawer-height));
    overflow: auto;
    border-right: none;
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
}
```

Three columns need roughly 1040px, so below 1000px (still above an iPad's
834 in portrait) rows of panes stop being columns. The review screen shows
only the current pane, without its caption, which the tab already reads. The
pull request screen keeps stacking, so every rule names `.panes--review` or
its complement; unscoped, the tab rules would hide the pull request screen,
whose panes never carry `pane--showing`.

```css
/*| id: design-responsive-panes
@layer components-narrow {
  @media (max-width: 1000px) {
    .pane-tabs {
      display: flex;
    }

    .panes--review .pane {
      display: none;
    }

    .panes--review .pane--showing {
      display: flex;
      flex: 1;
      width: auto;
      min-width: 0;
      border-right: none;
    }

    .panes--review .pane__header {
      display: none;
    }

    .panes:not(.panes--review) {
      flex-direction: column;
      overflow: auto;
    }

    .panes:not(.panes--review) .pane {
      width: auto;
      min-width: 0;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .panes:not(.panes--review) .pane:has(+ .splitter) {
      border-bottom: none;
    }

    .panes:not(.panes--review) .pane--diff {
      flex: 1 0 auto;
      overflow: visible;
      border-bottom: none;
    }
  }
}
```

## Resizing a pane

Picker columns and the commit drawer carry a splitter. A drag is clamped at
the pane's minimum and at whatever leaves the giving pane `REST` pixels. A
pane nobody has resized stores nothing, so it keeps following the default in
[Design tokens](tokens.md).

```ts
//| id: frontend-model-pane-sizes
//| file: src/frontend/model/paneSizes.ts
import * as z from "zod";

export type PaneKey =
  | "local-before"
  | "local-after"
  | "local-log"
  | "local-combined"
  | "pull-commits";
export type Axis = "x" | "y";

/** One entry per resizable pane: which way it grows and how small it may get. */
export const PANES: Record<PaneKey, { axis: Axis; min: number }> = {
  "local-before": { axis: "x", min: 160 },
  "local-after": { axis: "x", min: 160 },
  "local-log": { axis: "x", min: 160 },
  "local-combined": { axis: "x", min: 160 },
  "pull-commits": { axis: "y", min: 48 },
};

/** What a drag must always leave the pane that gives way. */
export const REST = 200;

export const PaneSizes = z.object({
  "local-before": z.number().optional(),
  "local-after": z.number().optional(),
  "local-log": z.number().optional(),
  "local-combined": z.number().optional(),
  "pull-commits": z.number().optional(),
});
export type PaneSizes = z.infer<typeof PaneSizes>;

/** Clamps a dragged size between the pane's minimum and what leaves the
 *  neighbouring pane `REST` pixels. The minimum wins when `room` is too small
 *  for both. */
export function clampSize(key: PaneKey, size: number, room: number): number {
  const { min } = PANES[key];
  return Math.round(Math.max(min, Math.min(size, room - REST)));
}
```

```ts
//| id: frontend-model-pane-sizes-test
//| file: src/frontend/model/paneSizes.test.ts
import { describe, expect, test } from "bun:test";
import { clampSize, REST } from "./paneSizes";

describe("clampSize", () => {
  test("keeps a size that fits", () => {
    // arrange
    const room = 1000;

    // act
    const size = clampSize("local-before", 300, room);

    // assert
    expect(size).toBe(300);
  });

  test("stops at the pane's minimum", () => {
    // act
    const size = clampSize("local-before", 20, 1000);

    // assert
    expect(size).toBe(160);
  });

  test("leaves the pane giving way its rest", () => {
    // arrange
    const room = 1000;

    // act
    const size = clampSize("pull-commits", 950, room);

    // assert
    expect(size).toBe(room - REST);
  });

  test("keeps the minimum when the room cannot hold both", () => {
    // act
    const size = clampSize("local-after", 300, 250);

    // assert
    expect(size).toBe(160);
  });

  test("rounds to a whole pixel", () => {
    // act
    const size = clampSize("pull-commits", 120.6, 1000);

    // assert
    expect(size).toBe(121);
  });
});
```

```ts
//| id: frontend-persistence-pane-sizes
//| file: src/frontend/persistence/paneSizes.ts
import { PaneSizes } from "../model/paneSizes";
import { localRepository } from "./local";

export const paneSizesRepository = localRepository<PaneSizes>(
  "diffy.panes.v1",
  PaneSizes,
  {},
);
```

```ts
//| id: frontend-state-pane-sizes
//| file: src/frontend/state/paneSizes.ts
import { useCallback } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSizesRepository } from "../persistence/paneSizes";
import { useStored } from "./stored";

export type Resize = (pane: PaneKey, size: number | null) => void;

export function usePaneSizes(): [PaneSizes, Resize] {
  const [sizes, update] = useStored(paneSizesRepository);

  // null means the default: drop the entry rather than freeze today's value.
  const resize = useCallback<Resize>(
    (pane, size) => {
      update((current) => {
        const { [pane]: _, ...rest } = current;
        return size === null ? rest : { ...rest, [pane]: size };
      });
    },
    [update],
  );

  return [sizes, resize];
}
```

`Splitter` sits right after the pane it resizes, so it finds that pane as
its previous sibling, and the row's last child is the pane that gives way.
Arrow keys step it and a double click restores the default.

```tsx
//| id: frontend-view-splitter
//| file: src/frontend/views/Splitter.tsx
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";
import { clampSize, PANES, type PaneKey } from "../model/paneSizes";

const STEP = 16;

const KEYS: Record<"x" | "y", Record<string, number>> = {
  x: { ArrowLeft: -STEP, ArrowRight: STEP },
  y: { ArrowUp: -STEP, ArrowDown: STEP },
};

/** The inline length a sized pane reads in place of its default. */
export function paneSize(size: number | null): CSSProperties | undefined {
  if (size === null) return undefined;
  return { "--pane-size": `${size}px` } as CSSProperties;
}

interface Measure {
  pane: HTMLElement;
  start: number;
  room: number;
}

interface Drag extends Measure {
  origin: number;
  last: number | null;
}

export function Splitter({
  pane,
  size,
  onResize,
  label,
}: {
  pane: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  label: string;
}) {
  const { axis } = PANES[pane];
  const drag = useRef<Drag | null>(null);

  const along = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return axis === "x" ? rect.width : rect.height;
  };

  // No ref threaded from the screen: the pane is the previous sibling and the
  // pane giving way is the row's last child.
  const measure = (handle: HTMLElement): Measure | null => {
    const target = handle.previousElementSibling;
    const giving = handle.parentElement?.lastElementChild;
    if (!(target instanceof HTMLElement) || giving == null) return null;
    const start = along(target);
    return { pane: target, start, room: start + along(giving) };
  };

  const point = (event: ReactPointerEvent) =>
    axis === "x" ? event.clientX : event.clientY;

  const finish = () => {
    const last = drag.current?.last ?? null;
    drag.current = null;
    if (last !== null) onResize(last);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator the reader drags is a widget, and `<hr>` is a thematic break
    <div
      role="separator"
      // Names the line the handle draws, not the way it moves.
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size ?? undefined}
      aria-valuemin={PANES[pane].min}
      tabIndex={0}
      className={`splitter splitter--${axis}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const measured = measure(event.currentTarget);
        if (measured === null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { ...measured, origin: point(event), last: null };
      }}
      onPointerMove={(event) => {
        const now = drag.current;
        if (now === null) return;
        const next = clampSize(
          pane,
          now.start + point(event) - now.origin,
          now.room,
        );
        // Not through React: re-rendering a thousand-row diff per pointer
        // move for one CSS length. onResize runs once, on release.
        // pane--sized lifts the stylesheet's minimum during the drag too.
        now.last = next;
        now.pane.classList.add("pane--sized");
        now.pane.style.setProperty("--pane-size", `${next}px`);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = KEYS[axis][event.key];
        if (step === undefined) return;
        const measured = measure(event.currentTarget);
        if (measured === null) return;
        event.preventDefault();
        onResize(clampSize(pane, measured.start + step, measured.room));
      }}
      onDoubleClick={() => onResize(null)}
    />
  );
}
```

The handle draws the one-pixel rule, so the pane before it drops its own
border there; a pseudo-element widens the hit area without thickening it.

```css
/*| id: design-splitter
@layer components {
  .splitter {
    position: relative;
    z-index: 1;
    flex: none;
    background: var(--border);
    touch-action: none;
  }

  .splitter::before {
    position: absolute;
    content: "";
  }

  .splitter--x {
    width: 1px;
    cursor: col-resize;
  }

  .splitter--x::before {
    inset: 0 calc(-1 * var(--space-1));
  }

  .splitter--y {
    height: 1px;
    cursor: row-resize;
  }

  .splitter--y::before {
    inset: calc(-1 * var(--space-1)) 0;
  }

  .splitter:hover,
  .splitter:focus-visible,
  .splitter:active {
    background: var(--accent);
    outline: none;
  }

  .pane:has(+ .splitter--x) {
    border-right: none;
  }

  .pane:has(+ .splitter--y) {
    border-bottom: none;
  }

  .pane.pane--sized {
    min-width: 0;
  }
}
```

```css
/*| id: design-splitter
@layer components-narrow {
  @media (max-width: 1000px) {
    .panes--review .splitter {
      display: none;
    }
  }
}
```
