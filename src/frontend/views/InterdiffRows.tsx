// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-interdiff-rows>>[init]
import { useState } from "react";
import type { ReviewActions, ReviewedRow } from "../model/review";
import type { SourceLookup } from "../model/source";
import { ComparisonHeader } from "./ComparisonHeader";
import { CommentComposer, CommentThreads, DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  sources,
  review,
}: {
  rows: ReviewedRow[];
  sources: SourceLookup;
  /** Null while there is no review document to change, which draws each
   *  row with nothing on it that would write one. */
  review: ReviewActions | null;
}) {
  const [composing, setComposing] = useState<string | null>(null);

  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader
            row={row}
            onMarkSeen={review && (() => review.markSeen(row))}
            onComment={review && (() => setComposing(rowKey(row)))}
          />
          {review !== null && composing === rowKey(row) && (
            <CommentComposer
              anchor={{ kind: "comparison" }}
              onCancel={() => setComposing(null)}
              onSubmit={(anchor, body) => {
                review.addComment(row, anchor, body);
                setComposing(null);
              }}
            />
          )}
          {review !== null && (
            <CommentThreads
              comments={row.comments.filter(
                (comment) => comment.kind === "comparison",
              )}
              onResolveComment={review.resolveComment}
              onDropComment={review.dropComment}
            />
          )}
          {row.files.length === 0 ? (
            <p className="interdiff-empty">
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView
              files={row.files}
              sources={sources}
              scope={rowKey(row)}
              review={
                review === null
                  ? undefined
                  : {
                      comments: row.comments,
                      onAddComment: (anchor, body) =>
                        review.addComment(row, anchor, body),
                      onResolveComment: review.resolveComment,
                      onDropComment: review.dropComment,
                      viewed: row.viewed,
                      onToggleViewed: (file) => review.toggleViewed(row, file),
                    }
              }
            />
          )}
        </section>
      ))}
    </div>
  );
}

/** Also the scope [`DiffView` anchors](file-tree.md#folding-a-diffs-files-into-a-tree)
 *  its files under, so two rows never collide on the same file's id. */
export function rowKey(row: ReviewedRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}
// ~/~ end
