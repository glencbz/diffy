// ~/~ begin <<docs/architecture/frontend/review.md#frontend-state-review>>[init]
import { useMemo } from "react";
import {
  type Anchor,
  applyCommand,
  commentOn,
  type FileVersion,
  markSeen,
  markViewed,
  type ReviewCommand,
  type ReviewDocument,
  type ReviewedRow,
} from "../model/review";
import { reviewRepository } from "../persistence/review";
import { useStored } from "./stored";

export interface ReviewHandle {
  document: ReviewDocument;
  markSeen: (row: ReviewedRow) => void;
  addComment: (row: ReviewedRow, anchor: Anchor, body: string) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
  toggleViewed: (row: ReviewedRow, file: FileVersion) => void;
}

export function useReview(): ReviewHandle {
  const [document, update] = useStored(reviewRepository);

  const mutators = useMemo<Omit<ReviewHandle, "document">>(() => {
    const now = () => new Date().toISOString();
    const send = (command: ReviewCommand) =>
      update((current) => applyCommand(current, command));
    return {
      markSeen: (row) => send(markSeen(row, now())),
      addComment: (row, anchor, body) =>
        send(
          commentOn(row, {
            id: crypto.randomUUID(),
            ...anchor,
            body,
            createdAt: now(),
            author: "reader",
          }),
        ),
      resolveComment: (id, resolved) =>
        send({ kind: "resolve-comment", id, resolved }),
      dropComment: (id) => send({ kind: "delete-comment", id }),
      toggleViewed: (row, file) => send(markViewed(row, file, now())),
    };
  }, [update]);

  return { document, ...mutators };
}
// ~/~ end
