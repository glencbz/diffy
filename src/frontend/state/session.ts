// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-state-session>>[init]
import { useCallback } from "react";
import type {
  Comment,
  FileVersion,
  LineAnchor,
  SessionDocument,
} from "../model/review";
import { sessionRepository } from "../persistence/session";
import { flipViewed, type ReviewedRow, sameComparison } from "./review";
import { useStored } from "./stored";

export interface Session {
  document: SessionDocument;
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

export function useSession(): Session {
  const [document, update] = useStored(sessionRepository);

  const markSeen = useCallback(
    (row: ReviewedRow) => {
      const comparison = {
        reviewKey: row.reviewKey,
        fromCommitId: row.from?.commitId ?? null,
        toCommitId: row.to?.commitId ?? null,
      };
      update((current) => {
        const marks = current.marks.filter(
          (mark) => !sameComparison(mark, comparison),
        );
        if (row.review.state === "reviewed") return { ...current, marks };
        return {
          ...current,
          marks: [
            ...marks,
            { ...comparison, seenAt: new Date().toISOString() },
          ],
        };
      });
    },
    [update],
  );

  const addComment = useCallback(
    (row: ReviewedRow, path: string, anchor: LineAnchor, body: string) => {
      const commit =
        anchor.side === "after" ? (row.to ?? row.from) : (row.from ?? row.to);
      const comment: Comment = {
        id: crypto.randomUUID(),
        reviewKey: row.reviewKey,
        path,
        side: anchor.side,
        line: anchor.line,
        commitId: commit?.commitId ?? "",
        body,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      update((current) => ({
        ...current,
        comments: [...current.comments, comment],
      }));
    },
    [update],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) => {
      update((current) => ({
        ...current,
        comments: current.comments.map((comment) =>
          comment.id === id ? { ...comment, resolved } : comment,
        ),
      }));
    },
    [update],
  );

  const dropComment = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== id),
      }));
    },
    [update],
  );

  const toggleViewed = useCallback(
    (row: ReviewedRow, file: FileVersion) => {
      update((current) =>
        flipViewed(current, row.reviewKey, file, new Date().toISOString()),
      );
    },
    [update],
  );

  return {
    document,
    markSeen,
    addComment,
    resolveComment,
    dropComment,
    toggleViewed,
  };
}
// ~/~ end
