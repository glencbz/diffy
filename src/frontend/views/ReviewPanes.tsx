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
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <PickerColumn caption="before">{before}</PickerColumn>
      <PickerColumn caption="after">{after}</PickerColumn>
      <div style={{ flex: 1, overflow: "auto" }}>{diff}</div>
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "25%",
        minWidth: 240,
        borderRight: "1px solid #ccc",
      }}
    >
      <h2
        style={{
          margin: 0,
          padding: "6px 8px",
          font: "inherit",
          fontWeight: "bold",
          background: "#f0f0f0",
          borderBottom: "1px solid #ccc",
        }}
      >
        {caption}
      </h2>
      <div style={{ overflow: "auto" }}>{children}</div>
    </div>
  );
}
// ~/~ end
