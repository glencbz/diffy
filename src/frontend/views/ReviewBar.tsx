// ~/~ begin <<docs/architecture/frontend/review.md#frontend-view-review-bar>>[init]
import type { ReactNode } from "react";
import type { FileDiff } from "../api";
import { fileVersionOf } from "../model/changedFiles";
import {
  type ComparisonReview,
  isViewed,
  type RowReview,
} from "../model/review";

/** Where the reader stands on one comparison, and the two things they can do
 *  about the whole of it. */
export function ReviewBar({
  review,
  files,
  commentLabel,
  onMarkSeen,
  onComment,
}: {
  review: ComparisonReview;
  files: FileDiff[];
  commentLabel: string;
  /** Null when there is no review document to write to. */
  onMarkSeen: (() => void) | null;
  onComment: (() => void) | null;
}) {
  const openComments = review.comments.filter(
    (comment) => !comment.resolved,
  ).length;
  const viewed = files.filter((file) =>
    isViewed(review.viewed, fileVersionOf(file)),
  ).length;

  return (
    <div className="review-bar">
      <ReviewChip review={review.review} />
      {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
      {files.length > 0 && (
        <span className="review-bar__viewed">
          {viewed} / {files.length} files viewed
        </span>
      )}
      {onMarkSeen !== null && (
        <button
          type="button"
          onClick={onMarkSeen}
          className="review-bar__mark-seen"
        >
          {review.review.state === "reviewed" ? "mark unseen" : "mark seen"}
        </button>
      )}
      {onComment !== null && (
        <button
          type="button"
          onClick={onComment}
          className="review-bar__comment"
        >
          {commentLabel}
        </button>
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

const TONE_CLASS: Record<"reviewed" | "changed" | "open", string> = {
  reviewed: "review-chip--resolved",
  changed: "review-chip--stale",
  open: "review-chip--open",
};

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  return <span className={`review-chip ${TONE_CLASS[tone]}`}>{children}</span>;
}
// ~/~ end
