// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-state-review>>[init]
import type { InterdiffRow } from "../api";
import type {
  Comment,
  FileVersion,
  Mark,
  SessionDocument,
  ViewedFile,
} from "../model/review";

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
  reviewKey: string;
  review: RowReview;
  comments: RowComment[];
  viewed: ViewedFile[];
}

/** What a mark uses to find its row again. A change id survives a rewrite, so
 *  a mark under one is still recognisable after the commit is amended. A
 *  backend with no change ids can only name an exact revision, so a rewrite
 *  yields a different key and the row reads as unseen, never as reviewed. */
export function reviewKey(row: InterdiffRow): string {
  const commit = row.to ?? row.from;
  if (commit === null) {
    throw new Error("interdiff row has no commit on either side");
  }
  return commit.changeId !== null
    ? `change:${commit.changeId}`
    : `rev:${commit.commitId}`;
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
    const key = reviewKey(row);
    const fromCommitId = row.from?.commitId ?? null;
    const toCommitId = row.to?.commitId ?? null;
    const marksForChange = document.marks.filter(
      (mark) => mark.reviewKey === key,
    );

    const comments = document.comments
      .filter((comment) => comment.reviewKey === key)
      .map((comment) => ({
        ...comment,
        stale:
          comment.commitId !== fromCommitId && comment.commitId !== toCommitId,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      ...row,
      reviewKey: key,
      review: reviewFor(marksForChange, fromCommitId, toCommitId),
      comments,
      viewed: document.viewed.filter((mark) => mark.reviewKey === key),
    };
  });
}

/** Whether two marks (or a mark and a comparison) name the same row: the
 * same change id filling the same before/after slots. Exported so the
 * session store can replace or remove a mark by the same key it is read
 * back by. */
export function sameComparison(
  a: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
  b: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
): boolean {
  return (
    a.reviewKey === b.reviewKey &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}

function sameVersion(a: FileVersion, b: FileVersion): boolean {
  return (
    a.path === b.path && a.oldBlob === b.oldBlob && a.newBlob === b.newBlob
  );
}

/** Whether one of a row's viewed marks covers the file as it reads now. */
export function isViewed(viewed: ViewedFile[], file: FileVersion): boolean {
  return viewed.some((mark) => sameVersion(mark, file));
}

/** The document with one file's viewed mark added, or removed if it is
 * there. */
export function flipViewed(
  document: SessionDocument,
  reviewKey: string,
  file: FileVersion,
  viewedAt: string,
): SessionDocument {
  const others = document.viewed.filter(
    (mark) => mark.reviewKey !== reviewKey || !sameVersion(mark, file),
  );
  if (others.length < document.viewed.length) {
    return { ...document, viewed: others };
  }
  return {
    ...document,
    viewed: [...others, { ...file, reviewKey, viewedAt }],
  };
}
// ~/~ end
