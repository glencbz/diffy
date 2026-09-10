// ~/~ begin <<docs/architecture/frontend.md#frontend-view-split-pane>>[init]
import type { ReactNode } from "react";

export function SplitPane({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: "38%",
          minWidth: 260,
          overflow: "auto",
          borderRight: "1px solid #ccc",
        }}
      >
        {left}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>{right}</div>
    </div>
  );
}
// ~/~ end
