// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-interdiff-rows>>[init]
import { useState } from "react";
import type { Anchor, ReviewedRow } from "../state/review";
import type { SourceLookup } from "../state/source";
import { ComparisonHeader } from "./ComparisonHeader";
import { CommentComposer, CommentThreads, DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  sources,
  onMarkSeen,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  rows: ReviewedRow[];
  sources: SourceLookup;
  onMarkSeen: (row: ReviewedRow) => void;
  onAddComment: (row: ReviewedRow, anchor: Anchor, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  const [composing, setComposing] = useState<string | null>(null);

  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader
            row={row}
            onMarkSeen={() => onMarkSeen(row)}
            onComment={() => setComposing(rowKey(row))}
          />
          {composing === rowKey(row) && (
            <CommentComposer
              anchor={{ kind: "comparison" }}
              onCancel={() => setComposing(null)}
              onSubmit={(anchor, body) => {
                onAddComment(row, anchor, body);
                setComposing(null);
              }}
            />
          )}
          <CommentThreads
            comments={row.comments.filter(
              (comment) => comment.kind === "comparison",
            )}
            onResolveComment={onResolveComment}
            onDropComment={onDropComment}
          />
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
              review={{
                comments: row.comments,
                onAddComment: (anchor, body) => onAddComment(row, anchor, body),
                onResolveComment,
                onDropComment,
              }}
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
