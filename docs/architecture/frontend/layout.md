# Layout

Both screens put narrow pickers beside a wide diff. These are the two
components that arrange them, and the rules for a window with no room for
columns, where the review screen shows one pane at a time and the pull
request screen stacks.

## Review panes

Three columns: the two pickers, then the diff. The pickers are narrow and
fixed; the diff takes what is left, because it is the thing being read. Each
picker column carries its own caption, since "before" and "after" are the only
labels that say which direction the interdiff runs.

The panes fill whatever `App` gives them rather than claiming the viewport,
because the mode switch sits above them and takes a strip of it.

Three columns on a wide screen, one pane at a time on a narrow one. Stacked,
the two pickers take sixty per cent of a phone before the diff starts, so a
tab list chooses which single pane has the window instead. The two graphs
then land in the identical rectangle, and moving from `before` to `after`
shows what changed between them in place, which is the comparison this screen
exists to make. That is why the tabs render above `.panes` and not inside a
pane: anything drawn between them would move under the reader as they flip.

Picking a commit does not move the tabs on. Jumping to the diff would take
the reader out of the graph they are reading and cost them the flip the
layout is for, so the tabs are the only way from one pane to another.

`PaneTabs` is private to this file for the same reason `PickerColumn` is: one
caller, and no meaning away from it. Both read `CAPTIONS`, so a pane's name
in its tab and in its own header cannot drift apart. A tab carries what is
picked on its side as well as its name, because a pane off screen is a pane
whose state the reader has no other way to see, and a count answers the
question a picker raises.

`pane--showing` is computed in React rather than left for CSS to work out
from an attribute, which makes the narrow rule two selectors: every pane
hidden, the one carrying the class shown. On a wide screen the class is inert
because nothing outside the media query reads it.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";

export type Pane = "before" | "after" | "diff";

const CAPTIONS: Record<Pane, string> = {
  before: "before",
  after: "after",
  diff: "diff",
};

export function ReviewPanes({
  before,
  after,
  diff,
  showing,
  onShow,
  selected,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <>
      <PaneTabs showing={showing} onShow={onShow} selected={selected} />
      <div className="panes panes--review">
        <PickerColumn pane="before" showing={showing}>
          {before}
        </PickerColumn>
        <PickerColumn pane="after" showing={showing}>
          {after}
        </PickerColumn>
        <div className={paneClass("pane pane--diff", showing === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  showing,
  onShow,
  selected,
}: {
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <nav className="pane-tabs">
      {(Object.keys(CAPTIONS) as Pane[]).map((pane) => (
        <button
          type="button"
          key={pane}
          onClick={() => onShow(pane)}
          className={
            pane === showing ? "pane-tab pane-tab--current" : "pane-tab"
          }
          aria-current={pane === showing}
        >
          <span className="pane-tab__caption">{CAPTIONS[pane]}</span>
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
  showing,
  children,
}: {
  pane: "before" | "after";
  showing: Pane;
  children: ReactNode;
}) {
  return (
    <div className={paneClass("pane pane--picker", pane === showing)}>
      <h2 className="pane__header">{CAPTIONS[pane]}</h2>
      <div className="pane__body">{children}</div>
    </div>
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
picker over a narrow commit strip and the diff, which is the part being read
and so gets the room.

The outer one also carries the bar and the scrim that [the list as a
sheet](#the-list-as-a-sheet) needs, since both belong to the same choice
between the list and the review.

```tsx
//| id: frontend-view-pull-panes
//| file: src/frontend/views/PullPanes.tsx
import type { ReactNode } from "react";
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

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

export function PullReviewPanes({
  header,
  picker,
  commits,
  diff,
}: {
  header: ReactNode;
  picker: ReactNode;
  commits: ReactNode;
  diff: ReactNode;
}) {
  return (
    <>
      {header}
      {picker}
      <div className="panes">
        <div className="pane pane--commits">{commits}</div>
        <div className="pane pane--diff">{diff}</div>
      </div>
    </>
  );
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
it, or the list is over the review. A wide window reads none of it, the way
`pane--showing` is inert outside the narrow rules.

The bar, the sheet's header and the scrim are drawn whole here and left
switched off, for the reason the tab list above is: how a component looks
belongs to the `components` layer, and the narrow rules decide only whether it
is on screen. The scrim is a `<button>` because it is a control, and a click
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
    display: none;
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
    .pull-bar,
    .pull-sheet__header {
      display: flex;
    }

    .pull-scrim {
      display: block;
    }

    .panes--browsing .pane--main {
      display: none;
    }

    .panes--browsing .pane--list {
      flex: 1;
    }

    .panes--reviewing .pane--list,
    .panes--picking .pane--list {
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

## The pane rules

Every screen is the same shape: columns that scroll on their own, divided by
a single-pixel rule. `.panes` is that row, `.pane` is a column, and the
modifiers say only how wide. Nothing about a pane's width lives in the view
that renders it.

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
}
```

Three columns want about 180 pixels for each picker and 680 for the diff, so
they hold together above roughly 1040 and nowhere below it. Under a thousand a
row of panes stops being columns at all: it turns into a stack and caps the
commit strip at a fraction of the viewport so the diff still has somewhere to
be.
An iPad held in portrait is 834 pixels wide, so a breakpoint drawn any tighter
than this leaves the commonest tablet with two pickers eating half the window
and not one description readable.

Under a thousand the review screen hides every pane but the showing one, and
with it the pane's own caption: the tab that put the pane on screen is marked
current and already reads `before`, so the header below it is the same word a
second time. The caption earns its place in columns, where nothing else says
which of the two a column is.

The pull request screen goes on stacking, inside a review. Its inner panes are
a commit strip over a diff, and nothing offers a reader a way to choose between
those, so each rule names `.panes--review` or everything that is not it.
Scoping the tab rules alone and leaving the stacking rules unscoped would hide
the pull request screen outright, since none of its panes ever carries
`pane--showing`. Its outer row asks a different question: the list against the
review is the choice [the sheet](#the-list-as-a-sheet) takes over, which
leaves the commit strip as the one pane wanting a cap on how much of a phone
it may hold.

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

    .panes:not(.panes--review) .pane--commits {
      width: auto;
      min-width: 0;
      max-height: 30vh;
    }

    .panes:not(.panes--review) .pane--diff {
      flex: 1 0 auto;
      border-bottom: none;
    }
  }
}
```
