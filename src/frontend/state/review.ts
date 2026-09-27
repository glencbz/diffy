// ~/~ begin <<docs/architecture/frontend/review.md#frontend-state-review>>[init]
import { useMemo } from "react";
import {
  addComment,
  dropComment,
  type FileVersion,
  flipSeen,
  flipViewed,
  type LineAnchor,
  type ReviewDocument,
  type ReviewedRow,
  resolveComment,
} from "../model/review";
import { reviewRepository } from "../persistence/review";
import { useStored } from "./stored";

export interface ReviewHandle {
  document: ReviewDocument;
  markSeen: (row: ReviewedRow) => void;
  addComment: (
    row: ReviewedRow,
    path: string,
    anchor: LineAnchor,
    body: string,
  ) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
  toggleViewed: (row: ReviewedRow, file: FileVersion) => void;
}

export function useReview(): ReviewHandle {
  const [document, update] = useStored(reviewRepository);

  const mutators = useMemo<Omit<ReviewHandle, "document">>(() => {
    const now = () => new Date().toISOString();
    return {
      markSeen: (row) => update((current) => flipSeen(current, row, now())),
      addComment: (row, path, anchor, body) =>
        update((current) =>
          addComment(current, row, {
            id: crypto.randomUUID(),
            path,
            ...anchor,
            body,
            createdAt: now(),
          }),
        ),
      resolveComment: (id, resolved) =>
        update((current) => resolveComment(current, id, resolved)),
      dropComment: (id) => update((current) => dropComment(current, id)),
      toggleViewed: (row, file) =>
        update((current) => flipViewed(current, row.reviewKey, file, now())),
    };
  }, [update]);

  return { document, ...mutators };
}
// ~/~ end
