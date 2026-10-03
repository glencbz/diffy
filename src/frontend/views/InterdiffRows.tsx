// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-interdiff-rows>>[init]
import { useState } from "react";
import type { ReviewActions, ReviewedRow } from "../model/review";
import type { Display } from "../model/settings";
import type { SourceLookup } from "../model/source";
import { CommitMessage } from "./CommitMessage";
import { ComparisonHeader } from "./ComparisonHeader";
import { CommentComposer, CommentThreads, DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  plain,
  sources,
  review,
  display,
}: {
  rows: ReviewedRow[];
  /** Whether these are commits' own diffs rather than an interdiff. */
  plain: boolean;
  sources: SourceLookup;
  /** Null while there is no review document to change, which draws each
   *  row with nothing on it that would write one. */
  review: ReviewActions | null;
  display: Display;
}) {
  const [composing, setComposing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <div>
      {rows.map((row) => (
        <section
          key={rowKey(row)}
          id={rowAnchor(row)}
          className="interdiff-row"
        >
          <ComparisonHeader
            row={row}
            plain={plain}
            onMarkSeen={review && (() => review.markSeen(row))}
            onComment={review && (() => setComposing(rowKey(row)))}
          />
          <CommitMessage
            description={(row.to ?? row.from)?.description ?? ""}
            className="interdiff-message"
            isExpanded={expanded.has(rowKey(row))}
            onExpand={() => toggleExpanded(rowKey(row))}
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
              display={display}
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

/** Keyed on commit ids: a reorder can put one change id on two rows.
 *  Also the scope [`DiffView` anchors](file-tree.md#folding-a-diffs-files-into-a-tree)
 *  its files under, so two rows never collide on the same file's id. */
export function rowKey(row: ReviewedRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}

/** The id of a row's whole section, header and all, which the
 *  [file navigator](file-tree.md#stepping-through-files) jumps to when a
 *  reader picks a commit rather than a file. */
export function rowAnchor(row: ReviewedRow): string {
  return `row-${rowKey(row)}`;
}
// ~/~ end
