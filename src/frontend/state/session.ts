// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-state-session>>[init]
import { useCallback, useState } from "react";
import {
  type Comment,
  type ReviewedRow,
  SessionDocument,
  sameComparison,
} from "./review";

const STORAGE_KEY = "diffy.session.v1";
const EMPTY_DOCUMENT: SessionDocument = { marks: [], comments: [] };

/** localStorage content is written by a possibly older version of this
 * app, or by hand in devtools; treat it as untrusted input and fall back
 * to an empty session rather than let a bad blob break the app. */
export function load(): SessionDocument {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return EMPTY_DOCUMENT;

  try {
    return SessionDocument.parse(JSON.parse(raw));
  } catch {
    return EMPTY_DOCUMENT;
  }
}

/** setItem throws in Safari private browsing and over quota; there is no
 * error channel from here back to a click handler, and a session that
 * keeps working for the tab without persisting beats one that throws. */
export function save(document: SessionDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // See the doc comment: persistence failure is not worth a UI state.
  }
}

export interface Session {
  document: SessionDocument;
  markSeen: (row: ReviewedRow) => void;
  addComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
}

export function useSession(): Session {
  const [document, setDocument] = useState<SessionDocument>(load);

  const update = useCallback(
    (compute: (current: SessionDocument) => SessionDocument) => {
      setDocument((current) => {
        const next = compute(current);
        save(next);
        return next;
      });
    },
    [],
  );

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
    (row: ReviewedRow, path: string, line: number, body: string) => {
      const comment: Comment = {
        id: crypto.randomUUID(),
        reviewKey: row.reviewKey,
        path,
        line,
        commitId: row.to?.commitId ?? row.from?.commitId ?? "",
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

  return { document, markSeen, addComment, resolveComment, dropComment };
}
// ~/~ end
