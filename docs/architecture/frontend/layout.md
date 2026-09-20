# Layout

Both screens put narrow pickers beside a wide diff. These are the two
components that arrange them, and the rules that stack them when the window is
too narrow to be columns at all.

## Review panes

Three columns: the two pickers, then the diff. The pickers are narrow and
fixed; the diff takes what is left, because it is the thing being read. Each
picker column carries its own caption, since "before" and "after" are the only
labels that say which direction the interdiff runs.

The panes fill whatever `App` gives them rather than claiming the viewport,
because the mode switch sits above them and takes a strip of it.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";

export function ReviewPanes({
  before,
  after,
  diff,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
}) {
  return (
    <div className="panes">
      <PickerColumn caption="before">{before}</PickerColumn>
      <PickerColumn caption="after">{after}</PickerColumn>
      <div className="pane pane--diff">{diff}</div>
    </div>
  );
}

function PickerColumn({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="pane pane--picker">
      <h2 className="pane__header">{caption}</h2>
      <div className="pane__body">{children}</div>
    </div>
  );
}
```

## Pull request panes

Two layouts, because the pull request screen nests. The outer one is the list
against everything else. The inner one stacks the header and the timeline over
a narrow commit strip and the diff, which is the part being read and so gets
the room.

```tsx
//| id: frontend-view-pull-panes
//| file: src/frontend/views/PullPanes.tsx
import type { ReactNode } from "react";

export function PullPanes({
  list,
  review,
}: {
  list: ReactNode;
  review: ReactNode;
}) {
  return (
    <div className="panes">
      <div className="pane pane--list">{list}</div>
      <div className="pane pane--main">{review}</div>
    </div>
  );
}

export function PullReviewPanes({
  header,
  timeline,
  commits,
  diff,
}: {
  header: ReactNode;
  timeline: ReactNode;
  commits: ReactNode;
  diff: ReactNode;
}) {
  return (
    <>
      {header}
      {timeline}
      <div className="panes">
        <div className="pane pane--commits">{commits}</div>
        <div className="pane pane--diff">{diff}</div>
      </div>
    </>
  );
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

Narrower than about two comfortable columns, a row of panes stops being
columns at all. This turns it into a stack and caps the pickers at a fraction
of the viewport so the diff still has somewhere to be. It is the only rule in
the stylesheet that overrides a component rather than retuning a length, which
is why it is the whole of the `components-narrow` layer. It sits with the
component it overrides, so the contradiction is one scroll apart rather than
two documents.
The breakpoint above it, which only retunes widths, is a metrics edit and
lives in [Design tokens](tokens.md).

```css
/*| id: design-responsive-panes
@layer components-narrow {
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
}
```
