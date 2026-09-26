// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-model-review>>[init]
import * as z from "zod";

const Comparison = z.object({
  reviewKey: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Side = z.enum(["before", "after"]);
export type Side = z.infer<typeof Side>;

/** Where on a file a comment is pinned: a line number on one side of it. */
export interface LineAnchor {
  side: Side;
  line: number;
}

export const Comment = z.object({
  id: z.string(),
  reviewKey: z.string(),
  path: z.string(),
  /** A stored comment with no side is an after-side one. Defaulting it keeps
   *  `load` from discarding a whole session written before the field. */
  side: Side.default("after"),
  line: z.number().int(),
  commitId: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
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

export const SessionDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
  viewed: z.array(ViewedFile).default([]),
});
export type SessionDocument = z.infer<typeof SessionDocument>;
// ~/~ end
