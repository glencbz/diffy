// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-interdiff-rows>>[init]
import { type ReactNode, useState } from "react";
import { type BeforePaths, compareOffer } from "../model/compared";
import type {
  DiffReview,
  ReviewActions,
  ReviewBarVariant,
  ReviewedRow,
} from "../model/review";
import type { Display } from "../model/settings";
import type { SourceLookup } from "../model/source";
import { CommentComposer, CommentThreads } from "./Comments";
import { CommitMessage } from "./CommitMessage";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView/DiffView";

export function InterdiffRows({
  rows,
  plain,
  sources,
  review,
  beforePaths,
  display,
}: {
  rows: ReviewedRow[];
  /** Whether these are commits' own diffs rather than an interdiff. */
  plain: boolean;
  sources: SourceLookup;
  beforePaths: BeforePaths;
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
      {rows.map((row) => {
        const parts = partsOf(
          review,
          beforePaths,
          row,
          composing,
          setComposing,
        );
        return (
          <section
            key={rowKey(row)}
            id={rowAnchor(row)}
            className="interdiff-row"
          >
            <ComparisonHeader row={row} plain={plain} bar={parts.bar} />
            <CommitMessage
              description={(row.to ?? row.from)?.description ?? ""}
              className="interdiff-message"
              isExpanded={expanded.has(rowKey(row))}
              onExpand={() => toggleExpanded(rowKey(row))}
            />
            {parts.comments}
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
                review={parts.diff}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** What a review document adds to a row that a row without one leaves out. */
interface RowParts {
  bar: ReviewBarVariant;
  /** The composer and threads on the whole comparison, under the message. */
  comments: ReactNode;
  diff: DiffReview | undefined;
}

function partsOf(
  review: ReviewActions | null,
  beforePaths: BeforePaths,
  row: ReviewedRow,
  composing: string | null,
  setComposing: (key: string | null) => void,
): RowParts {
  if (review === null) {
    return { bar: { kind: "read-only" }, comments: null, diff: undefined };
  }
  return {
    bar: {
      kind: "writable",
      onMarkSeen: () => review.markSeen(row),
      onComment: () => setComposing(rowKey(row)),
    },
    comments: (
      <>
        {composing === rowKey(row) && (
          <CommentComposer
            anchor={{ kind: "comparison" }}
            onCancel={() => setComposing(null)}
            onSubmit={(anchor, body) => {
              review.addComment(row, anchor, body);
              setComposing(null);
            }}
          />
        )}
        <CommentThreads
          comments={row.comments.filter(
            (comment) => comment.kind === "comparison",
          )}
          onEditComment={review.editComment}
          onResolveComment={review.resolveComment}
          onDropComment={review.dropComment}
          onReplyToComment={review.replyToComment}
          onEditReply={review.editReply}
          onDropReply={review.dropReply}
        />
      </>
    ),
    diff: {
      comments: row.comments,
      onAddComment: (anchor, body) => review.addComment(row, anchor, body),
      onEditComment: review.editComment,
      onResolveComment: review.resolveComment,
      onDropComment: review.dropComment,
      onReplyToComment: review.replyToComment,
      onEditReply: review.editReply,
      onDropReply: review.dropReply,
      viewed: row.viewed,
      onToggleViewed: (file) => review.toggleViewed(row, file),
      compare: compareOffer(row, beforePaths, review.compare),
    },
  };
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
