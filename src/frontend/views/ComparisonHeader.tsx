// ~/~ begin <<docs/architecture/frontend.md#frontend-view-comparison-header>>[init]
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  from,
  to,
}: {
  from: LogEntry | null;
  to: LogEntry | null;
}) {
  return (
    <header
      style={{
        padding: "8px 12px",
        background: "#fafafa",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Row caption="before" commit={from} />
      <Row caption="after" commit={to} />
    </header>
  );
}

function Row({
  caption,
  commit,
}: {
  caption: string;
  commit: LogEntry | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "#888", width: 56, flex: "none" }}>{caption}</span>
      {commit === null ? (
        <em style={{ color: "#999" }}>not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}
// ~/~ end
