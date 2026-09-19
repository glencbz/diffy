// ~/~ begin <<docs/architecture/frontend.md#frontend-view-comparison-header>>[init]
import type { CSSProperties, ReactNode } from "react";
import type { LogEntry } from "../api";
import type { ReviewedRow, RowReview } from "../state/review";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  row,
  onMarkSeen,
}: {
  row: ReviewedRow;
  onMarkSeen: () => void;
}) {
  const openComments = row.comments.filter(
    (comment) => !comment.resolved,
  ).length;

  return (
    <header
      style={{
        padding: "8px 12px",
        background: "#fafafa",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Row caption="before" commit={row.from} />
      <Row caption="after" commit={row.to} />
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}
      >
        <ReviewChip review={row.review} />
        {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
        <button type="button" onClick={onMarkSeen} style={{ font: "inherit" }}>
          {row.review.state === "reviewed" ? "mark unseen" : "mark seen"}
        </button>
      </div>
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

function ReviewChip({ review }: { review: RowReview }) {
  if (review.state === "unseen") return null;
  return review.state === "reviewed" ? (
    <Chip tone="reviewed">reviewed</Chip>
  ) : (
    <Chip tone="changed">changed since you looked</Chip>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  const toneStyle: Record<typeof tone, CSSProperties> = {
    reviewed: {
      background: "#edf7ed",
      color: "#2b6a2b",
      border: "1px solid #a8d5a8",
    },
    changed: {
      background: "#fdf5e3",
      color: "#8a5a00",
      border: "1px solid #e6c98a",
    },
    open: {
      background: "#fdecec",
      color: "#a01b1b",
      border: "1px solid #e6a8a8",
    },
  };
  return (
    <span
      style={{
        fontSize: 11,
        padding: "0 5px",
        borderRadius: 8,
        lineHeight: "15px",
        ...toneStyle[tone],
      }}
    >
      {children}
    </span>
  );
}
// ~/~ end
