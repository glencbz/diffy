// ~/~ begin <<docs/architecture/frontend.md#frontend-view-review-panes>>[init]
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
// ~/~ end
