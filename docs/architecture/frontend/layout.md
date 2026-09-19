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
