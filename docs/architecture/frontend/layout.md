# Layout

Both screens pair a picker with a wide diff: the local history screen puts
one commit graph beside it, or two when the reader asks for an interdiff, and
the pull request screen puts its commit list in a drawer over it. These are
the two components that arrange them, and the rules for a window with no room
for columns, where the review screen shows one pane at a time and the pull
request screen stacks.

## Review panes

Two columns by default: one commit graph, then the diff. Most of the time a
reader wants a normal diff of the commits they tick, and a second graph at
some other operation is a question they have not asked. The graph column is
called `commits` and is wide enough to read a description in, and the diff
takes the rest, because it is the thing being read.

`interdiff` opens the before side as a third column to the left. The two
pickers are then narrow, as wide as the reader has dragged them, and each
carries its own caption, since "before" and "after" are the only labels that
say which direction the interdiff runs. The one graph of the default and the
after graph of an interdiff are the same side, so ticking commits and then
opening an interdiff keeps what was ticked. Its width is not the same,
though: the lone graph is kept under its own key, `local-log`, so dragging a
narrow after column does not shrink the wide one, or the other way round.

The panes fill whatever `App` gives them rather than claiming the viewport,
because the mode switch sits above them and takes a strip of it.

Columns on a wide screen, one pane at a time on a narrow one. Stacked, the
pickers take most of a phone before the diff starts, so a tab list chooses
which single pane has the window instead. In an interdiff the two graphs
then land in the identical rectangle, and moving from `before` to `after`
shows what changed between them in place, which is the comparison an
interdiff exists to make. That is why the tabs render above `.panes` and not
inside a pane: anything drawn between them would move under the reader as
they flip. A `showing` that names the before pane after the interdiff is
closed falls back to the graph, so closing it never leaves a phone on a pane
that is gone.

Picking a commit does not move the tabs on. Jumping to the diff would take
the reader out of the graph they are reading and cost them the flip the
layout is for, so the tabs are the only way from one pane to another.

`PaneTabs` is private to this file for the same reason `PickerColumn` is: one
caller, and no meaning away from it. Both take their words from `caption`,
so a pane's name in its tab and in its own header cannot drift apart. A tab
carries what is picked on its side as well as its name, because a pane off
screen is a pane whose state the reader has no other way to see, and a count
answers the question a picker raises.

Each picker column is followed by a [splitter](#resizing-a-pane) that sets
its width, and the sizes come in as props like everything else here, so the
view stays a function of what it is handed and `App` owns the document they
are kept in.

`pane--showing` is computed in React rather than left for CSS to work out
from an attribute, which makes the narrow rule two selectors: every pane
hidden, the one carrying the class shown. On a wide screen the class is inert
because nothing outside the media query reads it.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSize, Splitter } from "./Splitter";

export type Pane = "before" | "after" | "diff";

/** What each pane is called. Without an interdiff the after side is the
 *  only graph, and "after" would name a comparison nobody asked for. */
function caption(pane: Pane, interdiff: boolean): string {
  if (pane === "after" && !interdiff) return "commits";
  return pane;
}

export function ReviewPanes({
  before,
  after,
  diff,
  interdiff,
  showing,
  onShow,
  selected,
  sizes,
  onResize,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
  /** Whether the before side is open beside the after side. */
  interdiff: boolean;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
  sizes: PaneSizes;
  onResize: (pane: PaneKey, size: number | null) => void;
}) {
  const panes: Pane[] = interdiff
    ? ["before", "after", "diff"]
    : ["after", "diff"];
  const current = panes.includes(showing) ? showing : "after";
  const afterKey: PaneKey = interdiff ? "local-after" : "local-log";

  return (
    <>
      <PaneTabs
        panes={panes}
        interdiff={interdiff}
        showing={current}
        onShow={onShow}
        selected={selected}
      />
      <div className="panes panes--review">
        {interdiff && (
          <PickerColumn
            pane="before"
            caption={caption("before", interdiff)}
            showing={current}
            sizeKey="local-before"
            size={sizes["local-before"] ?? null}
            onResize={(size) => onResize("local-before", size)}
          >
            {before}
          </PickerColumn>
        )}
        <PickerColumn
          pane="after"
          caption={caption("after", interdiff)}
          showing={current}
          sizeKey={afterKey}
          size={sizes[afterKey] ?? null}
          onResize={(size) => onResize(afterKey, size)}
        >
          {after}
        </PickerColumn>
        <div className={paneClass("pane pane--diff", current === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  panes,
  interdiff,
  showing,
  onShow,
  selected,
}: {
  panes: Pane[];
  interdiff: boolean;
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
          <span className="pane-tab__caption">{caption(pane, interdiff)}</span>
          {pane !== "diff" && (
            <span className="pane-tab__picked">{picked(selected[pane])}</span>
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
  pane: "before" | "after";
  caption: string;
  showing: Pane;
  sizeKey: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  children: ReactNode;
}) {
  const width = sizeKey === "local-log" ? "pane--log" : "pane--picker";
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

The tab list is `display: none` until the narrow rule turns it on, and its
whole appearance is defined here anyway, because how a component looks belongs
to the `components` layer whether or not the window is currently showing it.
The rows run down the window rather than across it: three captions each
carrying a line of detail have nowhere to go on a phone in a row, and a list
is what a tab strip becomes when the space is tall rather than wide. The
current row is marked with weight and the accent colour, as `.tab--current` is
marked, on the left edge instead of the bottom because that is the edge these
rows share.

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

Two layouts, because the pull request screen nests. The outer one is the list
against everything else. The inner one stacks the header and the comparison
picker over [a drawer of commits](#the-commit-drawer) and the diff, which is
the part being read and so gets the room.

The outer one also carries the bar and the scrim that [the list as a
sheet](#the-list-as-a-sheet) needs, and the rail that [the list as a
column](#the-list-as-a-column) folds to, since all three belong to the same
choice between the list and the review.

```tsx
//| id: frontend-view-pull-panes
//| file: src/frontend/views/PullPanes.tsx
import { type ReactNode, useState } from "react";
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";
import { paneSize, Splitter } from "./Splitter";

export type PullChoice =
  | { phase: "browsing" }
  | { phase: "reviewing"; pull: PullSummary }
  | { phase: "picking"; pull: PullSummary };

export function PullPanes({
  choice,
  onOpen,
  onDismiss,
  list,
  review,
}: {
  choice: PullChoice;
  onOpen: () => void;
  onDismiss: () => void;
  list: ReactNode;
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
          {list}
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
      {picker}
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

function DrawerBar({
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

## The commit drawer

The commits of a pull request sit above the diff, full width, rather than in
a column beside it. A column is as narrow as the diff can spare, and the
paired graph draws two lanes of subjects side by side, so beside the diff
either the lanes truncate every subject to a stub or the diff gives up a
third of the window for the whole session. Above the diff the graph has the
window's width and the diff keeps it too, and what they trade is height,
which the [splitter](#resizing-a-pane) under the drawer hands to the reader
to set.

Most of a review is spent reading the diff, not choosing from the list, so
the drawer folds away to its bar. The bar keeps what the list was for: where
the reader is in the stack, the row being read, and a stepper that moves to
the row before or after it without opening the list again. The stepper sits
apart from the rest of the bar, which is one button that folds or unfolds
the drawer, so a press on the bar does what it looks like it does wherever
it lands, and a press on an arrow never also folds.

The drawer opens on every visit. Whether it is folded is the arrangement of
one sitting, like which rows of the stack are open, and a screen that
remembered it would open a pull request with its commit list hidden and
nothing saying there is one, which is the first thing a reader of a new pull
request needs. So it is plain state in the view, and only its height, a
preference about the window, is kept.

The bar walks the rows the stack draws, not the commits of one side, so a
dropped commit is a step like any other. With nothing picked it says how many
commits there are and a step forward goes to the first.

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
}
```

On a phone the stepper is the control a thumb reaches for while reading, so
its buttons grow to a touch target, and the splitter's reach grows with them
because a finger is wider than a cursor.

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

## The list as a sheet

A phone has one column of room, and the list and the review both want it.
Stacked, the list holds the top third of the window for the whole session,
including long after the reader has finished choosing out of it, and the
review they opened gets what is left.

The list is modal instead. With nothing chosen it is the window. Choosing a
pull request collapses it to a bar naming the choice, and the review takes
everything under the bar. Pressing the bar brings the list back as a sheet
over the review, and the scrim or the sheet's own close control sends it away
again.

The screen next door meets the same squeeze with a tab list and this one does
not, because the two choices are not alike. Flipping between `before` and
`after` in one rectangle is the comparison that screen exists to make, and a
reader does it all session. Choosing a pull request is done once, so a control
for it standing on screen afterwards spends a phone's width on an answered
question. The bar is what is left of the question: the answer, and a way back.

`PullPanes` is told the phase as one value rather than a summary beside a
flag, because a flag admits a sheet open over nothing and there is no such
screen. [The controller](pull-requests.md) holds the same three phases keyed
by number, and this is that union with the summary looked up, which is what
the bar needs to name the choice.

The phase lands on the row of panes and not on the list pane, because each of
the three says how the row is divided: the list has the window, the review has
it, or the list is over the review. A wide window reads the same three,
[as a column](#the-list-as-a-column).

The bar and the scrim are drawn whole here and left switched off, for the
reason the tab list above is: how a component looks belongs to the
`components` layer, and the narrow rules decide only whether it is on screen.
The sheet's header is on wherever it is rendered, since a column opened over
a review needs the same caption and the same way to put it away. The scrim is a `<button>` because it is a control, and a click
handler on a `<div>` is a control a keyboard cannot reach.

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

The sheet slides out of the window rather than hiding, because a pane that is
`display: none` until it is wanted has nothing to animate from, and a reader
who just pressed the bar is owed the sight of where the list comes from.
`visibility` rides along with the transform so a sheet that is away is out of
the tab order as well as out of sight, and transitioning it is what holds the
sheet visible until the slide out has finished.

The sheet stops short of the top of the window so a strip of the review shows
above it. That strip is what says the list is over the review rather than
instead of it, which is the whole difference between this and giving the list
the window back.

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

A wide window has room for the list beside the review, but the list is still
an answered question once a pull request is open, and the diff is the thing
that wants the width. So the three phases divide a wide row too. Browsing, the
list is a column beside a review that has nothing in it yet. Choosing a pull
request folds the column to a rail down the left edge, and the review takes
the width back. Pressing the rail opens the column again beside the review,
with the sheet's header to fold it, and choosing out of it folds it by
itself, because the controller's phase is the only state there is and the
choice ends picking.

The rail is the wide window's bar, not the bar itself. The review's own header
already names the pull request across the top of a wide window, so a bar
there would say it twice; a rail spends thirty pixels of width instead of a
row of height, and says only what pressing it brings back. Nothing is over
anything, so there is no scrim, and the column takes its place in the row
rather than sliding over the review, which keeps the diff where the reader
left it.

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

Every screen is the same shape: columns that scroll on their own, divided by
a single-pixel rule. `.panes` is that row, `.pane` is a column, and the
modifiers say only how big. Nothing about a pane's default size lives in the
view that renders it; a size the reader dragged arrives as `--pane-size`.

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
    height: var(--pane-size, var(--pane-drawer-height));
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

Three columns want about 180 pixels for each picker and 680 for the diff, so
they hold together above roughly 1040 and nowhere below it. Under a thousand a
row of panes stops being columns at all: it turns into a stack that scrolls
as one page.
An iPad held in portrait is 834 pixels wide, so a breakpoint drawn any tighter
than this leaves the commonest tablet with two pickers eating half the window
and not one description readable.

Under a thousand the review screen hides every pane but the showing one, and
with it the pane's own caption: the tab that put the pane on screen is marked
current and already reads `before`, so the header below it is the same word a
second time. The caption earns its place in columns, where nothing else says
which of the two a column is.

The pull request screen goes on stacking, inside a review. Its inner panes are
a commit drawer over a diff, and nothing offers a reader a way to choose between
those, so each rule names `.panes--review` or everything that is not it.
Scoping the tab rules alone and leaving the stacking rules unscoped would hide
the pull request screen outright, since none of its panes ever carries
`pane--showing`. Its outer row asks a different question: the list against the
review is the choice [the sheet](#the-list-as-a-sheet) takes over, which
leaves the drawer as the one pane wanting a limit on how much of a phone it
may hold, and it keeps the height its splitter gives it on a wide screen.

A rule that contradicts a component instead of retuning a length belongs to
the `components-narrow` layer, and it sits in the document that holds the
component it overrides, so the contradiction is one scroll apart rather than
two documents. The breakpoint above this one, which only retunes widths, is a
metrics edit and lives in [Design tokens](tokens.md).

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

A fixed column is a guess about the reader's window and their repository. A
picker a quarter of the window wide is too narrow for a stack of long
subjects and too wide for a laptop reading a long diff, and only the reader
knows which of those they have today. So the picker columns carry a splitter
on their right edge, and [the commit drawer](#the-commit-drawer) one along its
foot, and dragging it sets the size the pane keeps.

Every resizable pane in the app is one entry in `PANES`, which says which way
it grows and how small it may get. A drag is clamped at both ends: at the
pane's minimum, so a column cannot be dragged down to a sliver nobody can
grab again, and at whatever leaves the pane giving way `REST` pixels, so the
diff is never squeezed out of the row. The document the browser keeps is a
size per pane, each one missing until the reader drags it, because a pane
nobody has resized should go on following the default in
[Design tokens](tokens.md) as that changes.

```ts
//| id: frontend-model-pane-sizes
//| file: src/frontend/model/paneSizes.ts
import * as z from "zod";

export type PaneKey =
  | "local-before"
  | "local-after"
  | "local-log"
  | "pull-commits";
export type Axis = "x" | "y";

/** One entry per resizable pane: which way it grows and how small it may get. */
export const PANES: Record<PaneKey, { axis: Axis; min: number }> = {
  "local-before": { axis: "x", min: 160 },
  "local-after": { axis: "x", min: 160 },
  "local-log": { axis: "x", min: 160 },
  "pull-commits": { axis: "y", min: 48 },
};

/** What a drag must always leave the pane that gives way. */
export const REST = 200;

export const PaneSizes = z.object({
  "local-before": z.number().optional(),
  "local-after": z.number().optional(),
  "local-log": z.number().optional(),
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

The sizes belong to one browser, like [settings](settings.md#display), and
are kept the same way.

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

`resize` takes `null` to mean the default, which drops the pane's entry
rather than writing down whatever the default measured at the time.

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

`Splitter` is the handle, and it sits in the row right after the pane it
resizes, so it finds that pane as its previous sibling and needs no ref
threaded through from the screen. The pane that gives way is the row's last
child, the diff on both screens, and the pane's own size plus that one's is
the room a drag has to work with.

A drag does not go through React. The diff beside a picker can be thousands
of rows, and setting state on every pointer move would render it sixty times
a second for a change that is one CSS length. The handle writes the clamped
length straight onto the pane's `--pane-size` while the pointer moves, and
calls `onResize` once when it is let go, at which point React writes the same
length and the stored document catches up. `pane--sized` goes onto the pane
as soon as the drag moves, for the same reason it is on a sized pane at rest:
the stylesheet's minimum would otherwise stop the drag short of the model's.

The keyboard gets the same control in steps, along the handle's own axis, and
a double click puts the pane back to its default. `aria-orientation` names
the line the handle draws, not the way it moves, which is why the handle
between two columns is `vertical`.

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

The handle draws the rule between the pane and the one beside it, so the
pane it follows gives up its own border on that edge rather than doubling it.
The rule stays one pixel and the handle's reach is wider, from a
pseudo-element hanging either side of it, because a pixel is too fine a
target for a mouse and a two-pixel rule would read as a heavier divider than
every other edge in the app. `touch-action: none` hands the pointer to the
drag instead of letting a finger on the handle scroll the page.

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

Under the thousand-pixel line the review screen shows one pane at a time, and
a column's width means nothing there, so its splitters go with the columns
and the showing pane's `width: auto` already outranks any size it carries.

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
