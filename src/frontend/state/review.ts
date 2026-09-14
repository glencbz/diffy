// ~/~ begin <<docs/architecture/frontend.md#frontend-state-review>>[init]
import type {
  Comment,
  InterdiffRow,
  Mark,
  SessionDocument,
  SessionEdit,
} from "../api";

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

export interface RowComment extends Comment {
  stale: boolean;
}

export interface ReviewedRow extends InterdiffRow {
  changeId: string;
  review: RowReview;
  comments: RowComment[];
}

export function rowChangeId(row: InterdiffRow): string {
  const changeId = row.to?.changeId ?? row.from?.changeId;
  if (changeId === undefined) {
    throw new Error("interdiff row has no commit on either side");
  }
  return changeId;
}

function latestMark(marks: Mark[]): Mark | null {
  return marks.reduce<Mark | null>(
    (latest, mark) =>
      latest === null || mark.seenAt > latest.seenAt ? mark : latest,
    null,
  );
}

/** Whether a mark describes the same comparison slot: both sides, or which
 * single side, the row fills. A reorder's drop and insert halves fill
 * opposite slots, so neither can speak for the other. */
function fillsSameSides(
  mark: Mark,
  fromCommitId: string | null,
  toCommitId: string | null,
): boolean {
  return (
    (mark.fromCommitId === null) === (fromCommitId === null) &&
    (mark.toCommitId === null) === (toCommitId === null)
  );
}

function reviewFor(
  marksForChange: Mark[],
  fromCommitId: string | null,
  toCommitId: string | null,
): RowReview {
  const exact = marksForChange.find(
    (mark) =>
      mark.fromCommitId === fromCommitId && mark.toCommitId === toCommitId,
  );
  if (exact !== undefined) return { state: "reviewed", seenAt: exact.seenAt };

  const related = marksForChange.filter(
    (mark) =>
      fillsSameSides(mark, fromCommitId, toCommitId) ||
      mark.fromCommitId === fromCommitId ||
      mark.toCommitId === toCommitId,
  );
  const latest = latestMark(related);
  if (latest === null) return { state: "unseen" };
  return {
    state: "changed",
    seenAt: latest.seenAt,
    seenFrom: latest.fromCommitId,
    seenTo: latest.toCommitId,
  };
}

export function reviewRows(
  rows: InterdiffRow[],
  document: SessionDocument,
): ReviewedRow[] {
  return rows.map((row) => {
    const changeId = rowChangeId(row);
    const fromCommitId = row.from?.commitId ?? null;
    const toCommitId = row.to?.commitId ?? null;
    const marksForChange = document.marks.filter(
      (mark) => mark.changeId === changeId,
    );

    const comments = document.comments
      .filter((comment) => comment.changeId === changeId)
      .map((comment) => ({
        ...comment,
        stale:
          comment.commitId !== fromCommitId && comment.commitId !== toCommitId,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      ...row,
      changeId,
      review: reviewFor(marksForChange, fromCommitId, toCommitId),
      comments,
    };
  });
}

function sameComparison(
  a: {
    changeId: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
  b: {
    changeId: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
): boolean {
  return (
    a.changeId === b.changeId &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}

/**
 * The client's half of a mutation: apply an edit to a local copy of the
 * document the same way the backend's SQL would, so the optimistic update
 * and the eventual server state never need reconciling.
 */
export function applyEdit(
  document: SessionDocument,
  edit: SessionEdit,
): SessionDocument {
  switch (edit.kind) {
    case "mark": {
      const mark: Mark = {
        changeId: edit.changeId,
        fromCommitId: edit.fromCommitId,
        toCommitId: edit.toCommitId,
        seenAt: edit.seenAt,
      };
      return {
        ...document,
        marks: [
          ...document.marks.filter((m) => !sameComparison(m, mark)),
          mark,
        ],
      };
    }

    case "unmark":
      return {
        ...document,
        marks: document.marks.filter((m) => !sameComparison(m, edit)),
      };

    case "comment":
      return {
        ...document,
        comments: [
          ...document.comments.filter((c) => c.id !== edit.comment.id),
          edit.comment,
        ],
      };

    case "resolveComment":
      return {
        ...document,
        comments: document.comments.map((c) =>
          c.id === edit.id ? { ...c, resolved: edit.resolved } : c,
        ),
      };

    case "dropComment":
      return {
        ...document,
        comments: document.comments.filter((c) => c.id !== edit.id),
      };
  }
}
// ~/~ end
