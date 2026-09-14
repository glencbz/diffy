// ~/~ begin <<docs/architecture/frontend.md#frontend-state-session>>[init]
import { useCallback, useEffect, useState } from "react";
import {
  fetchSession,
  postSessionEdit,
  type SessionDocument,
  type SessionEdit,
} from "../api";
import { applyEdit, type ReviewedRow } from "./review";

const EMPTY_DOCUMENT: SessionDocument = { marks: [], comments: [] };

export interface Session {
  document: SessionDocument;
  error: string | null;
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
  const [document, setDocument] = useState<SessionDocument>(EMPTY_DOCUMENT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchSession()
      .then((data) => {
        if (live) setDocument(data);
      })
      .catch((err: unknown) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback((edit: SessionEdit) => {
    setDocument((current) => applyEdit(current, edit));
    postSessionEdit(edit).catch((err: unknown) => {
      setError(String(err));
      fetchSession()
        .then((data) => setDocument(data))
        .catch((refetchErr: unknown) => setError(String(refetchErr)));
    });
  }, []);

  const markSeen = useCallback(
    (row: ReviewedRow) => {
      const comparison = {
        changeId: row.changeId,
        fromCommitId: row.from?.commitId ?? null,
        toCommitId: row.to?.commitId ?? null,
      };
      submit(
        row.review.state === "reviewed"
          ? { kind: "unmark", ...comparison }
          : { kind: "mark", ...comparison, seenAt: new Date().toISOString() },
      );
    },
    [submit],
  );

  const addComment = useCallback(
    (row: ReviewedRow, path: string, line: number, body: string) => {
      submit({
        kind: "comment",
        comment: {
          id: crypto.randomUUID(),
          changeId: row.changeId,
          path,
          line,
          commitId: row.to?.commitId ?? row.from?.commitId ?? "",
          body,
          resolved: false,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [submit],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) =>
      submit({ kind: "resolveComment", id, resolved }),
    [submit],
  );

  const dropComment = useCallback(
    (id: string) => submit({ kind: "dropComment", id }),
    [submit],
  );

  return { document, error, markSeen, addComment, resolveComment, dropComment };
}
// ~/~ end
