// ~/~ begin <<docs/architecture/frontend/review.md#frontend-model-review>>[init]
import * as z from "zod";
import type { InterdiffRow } from "../api";

const Comparison = z.object({
  reviewKey: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});
type Comparison = z.infer<typeof Comparison>;

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Side = z.enum(["before", "after"]);
export type Side = z.infer<typeof Side>;

/** Where on a file a line comment is pinned: a line number on one side. */
export interface LineAnchor {
  side: Side;
  line: number;
}

/** What a comment is about: one line of a file, a whole file, or the whole
 *  comparison. A stored comment with no kind is a line comment, and one with
 *  no side is on the after side. Defaulting both keeps `load` from
 *  discarding a whole document written before either field. */
export const Anchor = z.union([
  z.object({
    kind: z.literal("line").default("line"),
    path: z.string(),
    side: Side.default("after"),
    line: z.number().int(),
  }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("comparison") }),
]);
export type Anchor = z.infer<typeof Anchor>;

export const Comment = z.intersection(
  z.object({
    id: z.string(),
    reviewKey: z.string(),
    commitId: z.string(),
    body: z.string(),
    resolved: z.boolean(),
    createdAt: z.string(),
  }),
  Anchor,
);
export type Comment = z.infer<typeof Comment>;

/** One file as a comparison draws it: the path its header shows and the blob
 * on each side. Two versions that agree on all three draw the same diff. */
export const FileVersion = z.object({
  path: z.string(),
  oldBlob: z.string().nullable(),
  newBlob: z.string().nullable(),
});
export type FileVersion = z.infer<typeof FileVersion>;

export const ViewedFile = FileVersion.extend({
  reviewKey: z.string(),
  viewedAt: z.string(),
});
export type ViewedFile = z.infer<typeof ViewedFile>;

export const ReviewDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
  viewed: z.array(ViewedFile).default([]),
});
export type ReviewDocument = z.infer<typeof ReviewDocument>;

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

export type RowComment = Comment & { stale: boolean };

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
  document: ReviewDocument,
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
 * same change id filling the same before/after slots. */
function sameComparison(a: Comparison, b: Comparison): boolean {
  return (
    a.reviewKey === b.reviewKey &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}

/** The document with the row's mark added, or removed if the row reads
 * reviewed. Any mark on the same comparison is replaced rather than kept
 * beside the new one. */
export function flipSeen(
  document: ReviewDocument,
  row: ReviewedRow,
  seenAt: string,
): ReviewDocument {
  const comparison: Comparison = {
    reviewKey: row.reviewKey,
    fromCommitId: row.from?.commitId ?? null,
    toCommitId: row.to?.commitId ?? null,
  };
  const marks = document.marks.filter(
    (mark) => !sameComparison(mark, comparison),
  );
  if (row.review.state === "reviewed") return { ...document, marks };
  return { ...document, marks: [...marks, { ...comparison, seenAt }] };
}

/** The document with a comment added on a row, pinned to the commit what it
 * is about was read against. */
export function addComment(
  document: ReviewDocument,
  row: ReviewedRow,
  comment: Anchor & Pick<Comment, "id" | "body" | "createdAt">,
): ReviewDocument {
  const commit =
    comment.kind === "line" && comment.side === "before"
      ? (row.from ?? row.to)
      : (row.to ?? row.from);
  return {
    ...document,
    comments: [
      ...document.comments,
      {
        ...comment,
        reviewKey: row.reviewKey,
        commitId: commit?.commitId ?? "",
        resolved: false,
      },
    ],
  };
}

export function resolveComment(
  document: ReviewDocument,
  id: string,
  resolved: boolean,
): ReviewDocument {
  return {
    ...document,
    comments: document.comments.map((comment) =>
      comment.id === id ? { ...comment, resolved } : comment,
    ),
  };
}

export function dropComment(
  document: ReviewDocument,
  id: string,
): ReviewDocument {
  return {
    ...document,
    comments: document.comments.filter((comment) => comment.id !== id),
  };
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
  document: ReviewDocument,
  reviewKey: string,
  file: FileVersion,
  viewedAt: string,
): ReviewDocument {
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
