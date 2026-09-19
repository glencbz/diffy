// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-panes>>[init]
import type { ReactNode } from "react";

export function PullPanes({
  list,
  review,
}: {
  list: ReactNode;
  review: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div
        style={{
          width: "22%",
          minWidth: 220,
          flex: "none",
          overflow: "auto",
          borderRight: "1px solid #ccc",
        }}
      >
        {list}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
        }}
      >
        {review}
      </div>
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
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 260,
            flex: "none",
            overflow: "auto",
            borderRight: "1px solid #ccc",
          }}
        >
          {commits}
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{diff}</div>
      </div>
    </>
  );
}
// ~/~ end
