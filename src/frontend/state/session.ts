// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-state-session>>[init]
import { useMemo } from "react";
import {
  addComment,
  dropComment,
  type FileVersion,
  flipSeen,
  flipViewed,
  type LineAnchor,
  type ReviewedRow,
  resolveComment,
  type SessionDocument,
} from "../model/review";
import { sessionRepository } from "../persistence/session";
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

  const mutators = useMemo<Omit<Session, "document">>(() => {
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
