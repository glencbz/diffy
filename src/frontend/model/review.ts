// ~/~ begin <<docs/architecture/frontend/review.md#frontend-model-review>>[init]
import * as z from "zod";
import type { AsyncState } from "./asyncState";
import { ComponentMap, withComponents } from "./components";
import type { InterdiffRow } from "./diff";
import { followLine, readPatch } from "./patch";

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

/** An answer on a comment's thread. It has no anchor, commit or resolution
 *  of its own: it is about whatever its comment is about. */
export const Reply = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: z.string(),
});
export type Reply = z.infer<typeof Reply>;

export const Comment = z.intersection(
  z.object({
    id: z.string(),
    reviewKey: z.string(),
    commitId: z.string(),
    body: z.string(),
    resolved: z.boolean(),
    createdAt: z.string(),
    /** Who wrote it. A comment kept before comments had authors was the
     *  reader's, since nothing else could write one. */
    author: z.string().default("reader"),
    /** Oldest first. A comment kept before threads had none. */
    replies: z.array(Reply).default([]),
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

/** One version of a series the reader said they reviewed: a head of a pull
 *  request, named by its oid. */
export const ReviewedVersion = z.object({
  series: z.string(),
  version: z.string(),
  reviewedAt: z.string(),
});
export type ReviewedVersion = z.infer<typeof ReviewedVersion>;

/** The key a commit was last written on under, for a commit whose own id
 *  does not survive a rewrite. */
export const KeptKey = z.object({
  commitId: z.string(),
  reviewKey: z.string(),
});
export type KeptKey = z.infer<typeof KeptKey>;

/** A pairing the reader corrected by hand, for the two heads it pairs. */
export const KeptPairing = z.object({
  series: z.string(),
  before: z.string(),
  after: z.string(),
  slots: z.array(
    z.object({ left: z.string().nullable(), right: z.string().nullable() }),
  ),
});
export type KeptPairing = z.infer<typeof KeptPairing>;

/** An after-side file of a comparison the reader reads against a
 *  before-side file of their choosing. */
export const ComparedFile = z.object({
  reviewKey: z.string(),
  oldPath: z.string(),
  newPath: z.string(),
});
export type ComparedFile = z.infer<typeof ComparedFile>;

/** One version of a local review: a revset, the operation it was read at,
 *  and the commits it named then, oldest first. */
export const LocalVersion = z.object({
  operation: z.string(),
  revset: z.string(),
  commits: z.array(z.string()),
  registeredAt: z.string(),
});
export type LocalVersion = z.infer<typeof LocalVersion>;

/** A series someone said is ready for review, and every version of it they
 *  registered, oldest first. */
export const LocalReview = z.object({
  name: z.string(),
  versions: z.array(LocalVersion),
  /** When the reader forgot it; it can be restored until it is purged. */
  forgottenAt: z.string().optional(),
});
export type LocalReview = z.infer<typeof LocalReview>;

/** How long a forgotten local review waits to be restored before it is
 *  purged. */
export const KEEP_FORGOTTEN_MS = 7 * 24 * 60 * 60 * 1000;

export const ReviewDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
  viewed: z.array(ViewedFile).default([]),
  reviewed: z.array(ReviewedVersion).default([]),
  keys: z.array(KeptKey).default([]),
  pairings: z.array(KeptPairing).default([]),
  compared: z.array(ComparedFile).default([]),
  localReviews: z.array(LocalReview).default([]),
  componentMaps: z.array(ComponentMap).default([]),
});
export type ReviewDocument = z.infer<typeof ReviewDocument>;

export const EMPTY_REVIEW: ReviewDocument = {
  marks: [],
  comments: [],
  viewed: [],
  reviewed: [],
  keys: [],
  pairings: [],
  compared: [],
  localReviews: [],
  componentMaps: [],
};

export function isEmptyReview(document: ReviewDocument): boolean {
  return (
    document.marks.length === 0 &&
    document.comments.length === 0 &&
    document.viewed.length === 0 &&
    document.reviewed.length === 0 &&
    document.keys.length === 0 &&
    document.pairings.length === 0 &&
    document.compared.length === 0 &&
    document.localReviews.length === 0 &&
    document.componentMaps.length === 0
  );
}

/** The series a pull request's versions are marked reviewed under. */
export function pullSeries(repo: string, number: number): string {
  return `pull:${repo}#${number}`;
}

/** The series a local review's versions are marked reviewed under. */
export function localSeries(name: string): string {
  return `local:${name}`;
}

export function localReview(
  document: ReviewDocument,
  name: string,
): LocalReview | undefined {
  return document.localReviews.find((review) => review.name === name);
}

export const LOCAL_REVIEW_ORDERS = [
  "modified-newest",
  "modified-oldest",
  "name",
] as const;
export type LocalReviewOrder = (typeof LOCAL_REVIEW_ORDERS)[number];

/** A review was last modified when its newest version was registered. */
export function sortLocalReviews(
  reviews: LocalReview[],
  order: LocalReviewOrder,
): LocalReview[] {
  const modified = (review: LocalReview) =>
    review.versions.at(-1)?.registeredAt ?? "";
  return [...reviews].sort((a, b) =>
    order === "name"
      ? a.name.localeCompare(b.name)
      : order === "modified-newest"
        ? modified(b).localeCompare(modified(a))
        : modified(a).localeCompare(modified(b)),
  );
}

/** Whether the local review list offers delete and restore. They come
 *  together, so a deleted review can always be brought back, and neither
 *  comes without a review document to record it in. */
export type LocalReviewListVariant =
  | { kind: "read-only" }
  | {
      kind: "writable";
      onForget: (name: string) => void;
      onRestore: (name: string) => void;
    };

/** The versions of one series the reader marked reviewed. */
export function reviewedIn(
  document: ReviewDocument,
  series: string,
): ReviewedVersion[] {
  return document.reviewed.filter((version) => version.series === series);
}

/** The document as the server holds it, and how many writes made it. */
export const ReviewSnapshot = z.object({
  revision: z.number().int(),
  document: ReviewDocument,
});
export type ReviewSnapshot = z.infer<typeof ReviewSnapshot>;

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

/** A comment as one comparison reads it. `stale` says it was written
 *  against a commit other than the one the comparison shows. `numberedOn`
 *  says which side the comparison draws the tree a line comment counts its
 *  line in, or null when it draws neither, as it does for a comment from
 *  two versions back. */
export type RowComment = Comment & { stale: boolean; numberedOn: Side | null };

/** Which side of a comparison draws the tree a line comment's number counts
 *  lines of. An after-side anchor counts lines of its commit's tree, and a
 *  before-side one of its parent's, which only a comparison of that commit
 *  alone draws. Each side of a comparison of two commits draws that
 *  commit's tree. */
function numberedOn(
  comment: Comment,
  fromCommitId: string | null,
  toCommitId: string | null,
): Side | null {
  if (comment.kind !== "line") return null;
  const shown = toCommitId ?? fromCommitId;
  if (comment.side === "before") {
    const alone = fromCommitId === null || toCommitId === null;
    return alone && comment.commitId === shown ? "before" : null;
  }
  if (comment.commitId === shown) return "after";
  return comment.commitId === fromCommitId ? "before" : null;
}

/** Where a line comment's line is drawn in its file's `patch`, or null where
 *  the comparison draws neither tree its number counts lines of. A line
 *  counted on the before side lands where the patch keeps it, or stays on
 *  the before side where the patch removes it. */
export function drawnAt(comment: RowComment, patch: string): LineAnchor | null {
  if (comment.kind !== "line") return null;
  switch (comment.numberedOn) {
    case null:
      return null;
    case "after":
      return { side: "after", line: comment.line };
    case "before":
      return followLine(readPatch(patch), comment.line);
  }
}

/** Review memory for the files on screen. A diff that has one lets every
 * file, and every line of it on either side, be commented on; a diff that
 * has none renders read-only. */
export interface DiffReview {
  comments: RowComment[];
  onAddComment: (anchor: Anchor, body: string) => void;
  onEditComment: (id: string, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
  onReplyToComment: (id: string, body: string) => void;
  onEditReply: (commentId: string, replyId: string, body: string) => void;
  onDropReply: (commentId: string, replyId: string) => void;
  viewed: ViewedFile[];
  onToggleViewed: (file: FileVersion) => void;
  /** Null for a diff with no after side to compare from. */
  compare: CompareOffer | null;
}

/** What a diff's files can be [compared with](diff.md#comparing-two-files-by-hand). */
export interface CompareOffer {
  compared: ComparedFile[];
  /** The before side's whole tree, or null until it is asked for. */
  beforePaths: AsyncState<string[]> | null;
  onWantBeforePaths: () => void;
  /** Null puts the file's own diff back. */
  onCompare: (newPath: string, oldPath: string | null) => void;
}

/** Whether a review bar offers the two things a reader can do about a whole
 *  comparison. Without a review document there is nowhere to record either. */
export type ReviewBarVariant =
  | { kind: "read-only" }
  | { kind: "writable"; onMarkSeen: () => void; onComment: () => void };

/** What the reader has kept about one comparison: the key it is filed
 *  under, the commit on each side, and everything filed under that key. */
export interface ComparisonReview {
  reviewKey: string;
  fromCommitId: string | null;
  toCommitId: string | null;
  /** The commit to record under `reviewKey` when the reader writes anything
   *  here, so that the row it becomes in a later version inherits the key.
   *  Null for a key that survives a rewrite on its own, as a change id does. */
  keeps: string | null;
  review: RowReview;
  comments: RowComment[];
  viewed: ViewedFile[];
  compared: ComparedFile[];
}

export type ReviewedRow = InterdiffRow & ComparisonReview;

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

/** Everything the document holds under `key`, read against the commits a
 *  comparison has on each side now. */
export function reviewComparison(
  document: ReviewDocument,
  key: string,
  fromCommitId: string | null,
  toCommitId: string | null,
  keeps: string | null,
): ComparisonReview {
  const comments = document.comments
    .filter((comment) => comment.reviewKey === key)
    .map((comment) => ({
      ...comment,
      stale: comment.commitId !== (toCommitId ?? fromCommitId),
      numberedOn: numberedOn(comment, fromCommitId, toCommitId),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    reviewKey: key,
    fromCommitId,
    toCommitId,
    keeps,
    review: reviewFor(
      document.marks.filter((mark) => mark.reviewKey === key),
      fromCommitId,
      toCommitId,
    ),
    comments,
    viewed: document.viewed.filter((mark) => mark.reviewKey === key),
    compared: document.compared.filter((file) => file.reviewKey === key),
  };
}

export function reviewRows(
  rows: InterdiffRow[],
  document: ReviewDocument,
): ReviewedRow[] {
  return rows.map((row) => ({
    ...row,
    ...reviewComparison(
      document,
      reviewKey(row),
      row.from?.commitId ?? null,
      row.to?.commitId ?? null,
      null,
    ),
  }));
}

/** The key a pull request row is filed under. A commit has no id of its own
 *  that survives a force push, so a row takes the key its before commit was
 *  given when the reader last wrote on it, and a row whose before commit was
 *  never written on, or that has none, starts a key from its own commit.
 *  Writing on the row records that key for the row's own commit, which is
 *  what the row it becomes in the next version inherits. */
export function pullRowKey(
  document: ReviewDocument,
  before: string | null,
  after: string | null,
): { reviewKey: string; keeps: string } {
  const own = after ?? before;
  if (own === null) throw new Error("a pull request row has no commit");
  const kept = (commitId: string | null) =>
    commitId === null
      ? undefined
      : document.keys.find((key) => key.commitId === commitId)?.reviewKey;
  const inherited = before !== null ? kept(before) : kept(after);
  return { reviewKey: inherited ?? `rev:${own}`, keeps: own };
}

/** The key a local review's row is filed under: its change id, which
 *  survives the rewrites between one registration and the next, so there is
 *  nothing to record for the next version to inherit. */
export function localRowKey(
  before: { commitId: string; changeId: string | null } | null,
  after: { commitId: string; changeId: string | null } | null,
): { reviewKey: string; keeps: null } {
  const own = after ?? before;
  if (own === null) throw new Error("a local review row has no commit");
  const reviewKey =
    own.changeId === null ? `rev:${own.commitId}` : `change:${own.changeId}`;
  return { reviewKey, keeps: null };
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

function sameVersion(a: FileVersion, b: FileVersion): boolean {
  return (
    a.path === b.path && a.oldBlob === b.oldBlob && a.newBlob === b.newBlob
  );
}

/** Whether one of a row's viewed marks covers the file as it reads now. */
export function isViewed(viewed: ViewedFile[], file: FileVersion): boolean {
  return viewed.some((mark) => sameVersion(mark, file));
}

/** One change a reader or an agent makes to the review document. Each says
 *  what the state should become, so applying one twice leaves what applying
 *  it once did. */
export const ReviewCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set-seen"),
    comparison: Comparison,
    seen: z.boolean(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal("set-viewed"),
    reviewKey: z.string(),
    file: FileVersion,
    viewed: z.boolean(),
    at: z.string(),
  }),
  z.object({ kind: z.literal("add-comment"), comment: Comment }),
  z.object({
    kind: z.literal("edit-comment"),
    id: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("resolve-comment"),
    id: z.string(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal("delete-comment"), id: z.string() }),
  z.object({
    kind: z.literal("add-reply"),
    commentId: z.string(),
    reply: Reply,
  }),
  z.object({
    kind: z.literal("edit-reply"),
    commentId: z.string(),
    replyId: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("delete-reply"),
    commentId: z.string(),
    replyId: z.string(),
  }),
  z.object({
    kind: z.literal("mark-reviewed"),
    series: z.string(),
    version: z.string(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal("set-key"),
    commitId: z.string(),
    reviewKey: z.string(),
  }),
  z.object({
    kind: z.literal("set-compared"),
    reviewKey: z.string(),
    newPath: z.string(),
    /** Null puts the file's own diff back. */
    oldPath: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("set-pairing"),
    series: z.string(),
    before: z.string(),
    after: z.string(),
    /** Null puts the heuristic back. */
    slots: KeptPairing.shape.slots.nullable(),
  }),
  z.object({
    kind: z.literal("register"),
    name: z.string().min(1),
    version: LocalVersion,
  }),
  z.object({
    kind: z.literal("forget-review"),
    name: z.string(),
    at: z.string(),
  }),
  z.object({ kind: z.literal("restore-review"), name: z.string() }),
  z.object({ kind: z.literal("purge-forgotten"), before: z.string() }),
  z.object({ kind: z.literal("write-components"), map: ComponentMap }),
  z.object({ kind: z.literal("import"), document: ReviewDocument }),
]);
export type ReviewCommand = z.infer<typeof ReviewCommand>;

export function applyCommand(
  document: ReviewDocument,
  command: ReviewCommand,
): ReviewDocument {
  switch (command.kind) {
    case "set-seen": {
      const marks = document.marks.filter(
        (mark) => !sameComparison(mark, command.comparison),
      );
      return {
        ...document,
        marks: command.seen
          ? [...marks, { ...command.comparison, seenAt: command.at }]
          : marks,
      };
    }
    case "set-viewed": {
      const viewed = document.viewed.filter(
        (mark) =>
          mark.reviewKey !== command.reviewKey ||
          !sameVersion(mark, command.file),
      );
      return {
        ...document,
        viewed: command.viewed
          ? [
              ...viewed,
              {
                ...command.file,
                reviewKey: command.reviewKey,
                viewedAt: command.at,
              },
            ]
          : viewed,
      };
    }
    case "add-comment":
      return document.comments.some(
        (comment) => comment.id === command.comment.id,
      )
        ? document
        : { ...document, comments: [...document.comments, command.comment] };
    case "edit-comment":
      return {
        ...document,
        comments: document.comments.map((comment) =>
          comment.id === command.id
            ? { ...comment, body: command.body }
            : comment,
        ),
      };
    case "resolve-comment":
      return {
        ...document,
        comments: document.comments.map((comment) =>
          comment.id === command.id
            ? { ...comment, resolved: command.resolved }
            : comment,
        ),
      };
    case "delete-comment":
      return {
        ...document,
        comments: document.comments.filter(
          (comment) => comment.id !== command.id,
        ),
      };
    case "add-reply":
      return {
        ...document,
        comments: document.comments.map((comment) =>
          comment.id !== command.commentId ||
          comment.replies.some((reply) => reply.id === command.reply.id)
            ? comment
            : {
                ...comment,
                replies: [...comment.replies, command.reply],
                resolved: false,
              },
        ),
      };
    case "edit-reply":
      return {
        ...document,
        comments: document.comments.map((comment) =>
          comment.id === command.commentId
            ? {
                ...comment,
                replies: comment.replies.map((reply) =>
                  reply.id === command.replyId
                    ? { ...reply, body: command.body }
                    : reply,
                ),
              }
            : comment,
        ),
      };
    case "delete-reply":
      return {
        ...document,
        comments: document.comments.map((comment) =>
          comment.id === command.commentId
            ? {
                ...comment,
                replies: comment.replies.filter(
                  (reply) => reply.id !== command.replyId,
                ),
              }
            : comment,
        ),
      };
    case "mark-reviewed":
      return {
        ...document,
        reviewed: added(
          document.reviewed,
          [
            {
              series: command.series,
              version: command.version,
              reviewedAt: command.at,
            },
          ],
          sameReviewedVersion,
        ),
      };
    case "set-key":
      return {
        ...document,
        keys: [
          ...document.keys.filter((key) => key.commitId !== command.commitId),
          { commitId: command.commitId, reviewKey: command.reviewKey },
        ],
      };
    case "set-pairing": {
      const pairings = document.pairings.filter(
        (kept) => !samePairing(kept, command),
      );
      const { series, before, after, slots } = command;
      return {
        ...document,
        pairings:
          slots === null
            ? pairings
            : [...pairings, { series, before, after, slots }],
      };
    }
    case "set-compared": {
      const { reviewKey, newPath, oldPath } = command;
      const compared = document.compared.filter(
        (file) => file.reviewKey !== reviewKey || file.newPath !== newPath,
      );
      return {
        ...document,
        compared:
          oldPath === null
            ? compared
            : [...compared, { reviewKey, oldPath, newPath }],
      };
    }
    case "register":
      return {
        ...document,
        localReviews: registered(
          document.localReviews,
          command.name,
          command.version,
        ),
      };
    case "forget-review":
      return {
        ...document,
        localReviews: document.localReviews.map((review) =>
          review.name === command.name && review.forgottenAt === undefined
            ? { ...review, forgottenAt: command.at }
            : review,
        ),
      };
    case "restore-review":
      return {
        ...document,
        localReviews: document.localReviews.map((review) => {
          if (review.name !== command.name) return review;
          const { forgottenAt: _, ...restored } = review;
          return restored;
        }),
      };
    case "purge-forgotten": {
      const gone = purgeable(document, command.before);
      const purged = new Set(gone.map((review) => localSeries(review.name)));
      return {
        ...document,
        localReviews: document.localReviews.filter(
          (review) => !gone.includes(review),
        ),
        reviewed: document.reviewed.filter(
          (version) => !purged.has(version.series),
        ),
        pairings: document.pairings.filter((kept) => !purged.has(kept.series)),
        componentMaps: document.componentMaps.filter(
          (map) => !purged.has(map.series),
        ),
      };
    }
    case "write-components":
      return {
        ...document,
        componentMaps: withComponents(document.componentMaps, command.map),
      };
    case "import":
      return {
        marks: added(document.marks, command.document.marks, sameComparison),
        comments: added(
          document.comments,
          command.document.comments,
          (a, b) => a.id === b.id,
        ),
        viewed: added(
          document.viewed,
          command.document.viewed,
          (a, b) => a.reviewKey === b.reviewKey && sameVersion(a, b),
        ),
        reviewed: added(
          document.reviewed,
          command.document.reviewed,
          sameReviewedVersion,
        ),
        keys: added(
          document.keys,
          command.document.keys,
          (a, b) => a.commitId === b.commitId,
        ),
        pairings: added(
          document.pairings,
          command.document.pairings,
          samePairing,
        ),
        compared: added(
          document.compared,
          command.document.compared,
          (a, b) => a.reviewKey === b.reviewKey && a.newPath === b.newPath,
        ),
        localReviews: command.document.localReviews.reduce(
          (reviews, review) =>
            review.versions.reduce(
              (all, version) =>
                all.some(
                  (kept) =>
                    kept.name === review.name &&
                    kept.versions.some(
                      (held) => held.operation === version.operation,
                    ),
                )
                  ? all
                  : registered(all, review.name, version),
              reviews,
            ),
          document.localReviews,
        ),
        componentMaps: command.document.componentMaps.reduce(
          (maps, map) =>
            maps.some(
              (kept) =>
                kept.series === map.series && kept.version === map.version,
            )
              ? maps
              : withComponents(maps, map),
          document.componentMaps,
        ),
      };
  }
}

/** The local reviews forgotten before `before`. */
export function purgeable(
  document: ReviewDocument,
  before: string,
): LocalReview[] {
  return document.localReviews.filter(
    (review) => review.forgottenAt !== undefined && review.forgottenAt < before,
  );
}

/** `reviews` with `version` added to the review called `name`, which is
 *  started if there is none, or restored if it was forgotten. A version read at an operation the review
 *  already has a version for replaces it, since both describe the same
 *  moment of the repository. */
function registered(
  reviews: LocalReview[],
  name: string,
  version: LocalVersion,
): LocalReview[] {
  const review = reviews.find((candidate) => candidate.name === name);
  if (review === undefined) return [...reviews, { name, versions: [version] }];
  const at = review.versions.findIndex(
    (kept) => kept.operation === version.operation,
  );
  const versions =
    at === -1
      ? [...review.versions, version]
      : review.versions.map((kept, index) => (index === at ? version : kept));
  return reviews.map((candidate) =>
    candidate === review ? { name, versions } : candidate,
  );
}

type PairingHeads = Pick<KeptPairing, "series" | "before" | "after">;

function samePairing(a: PairingHeads, b: PairingHeads): boolean {
  return a.series === b.series && a.before === b.before && a.after === b.after;
}

/** The pairing the reader kept for two heads of a series, if they kept one. */
export function keptPairing(
  document: ReviewDocument,
  heads: PairingHeads,
): KeptPairing["slots"] | null {
  return (
    document.pairings.find((kept) => samePairing(kept, heads))?.slots ?? null
  );
}

function sameReviewedVersion(a: ReviewedVersion, b: ReviewedVersion): boolean {
  return a.series === b.series && a.version === b.version;
}

/** `existing` with each of `incoming` that names nothing already there. */
function added<T>(
  existing: T[],
  incoming: T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const result = [...existing];
  for (const item of incoming) {
    if (!result.some((kept) => same(kept, item))) result.push(item);
  }
  return result;
}

/** What a screen can do to the review document, once it has one to change. */
export interface ReviewActions {
  markSeen: (row: ComparisonReview) => void;
  addComment: (row: ComparisonReview, anchor: Anchor, body: string) => void;
  editComment: (id: string, body: string) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
  replyToComment: (id: string, body: string) => void;
  editReply: (commentId: string, replyId: string, body: string) => void;
  dropReply: (commentId: string, replyId: string) => void;
  toggleViewed: (row: ComparisonReview, file: FileVersion) => void;
  /** Reads `newPath` against `oldPath`, or against itself again for null. */
  compare: (
    row: ComparisonReview,
    newPath: string,
    oldPath: string | null,
  ) => void;
  markReviewed: (series: string, version: string) => void;
  keepPairing: (
    series: string,
    before: string,
    after: string,
    slots: KeptPairing["slots"] | null,
  ) => void;
  forgetReview: (name: string) => void;
  restoreReview: (name: string) => void;
}

/** The comparison a row stands for, as a mark names it. */
function comparisonOf(row: ComparisonReview): Comparison {
  return {
    reviewKey: row.reviewKey,
    fromCommitId: row.fromCommitId,
    toCommitId: row.toCommitId,
  };
}

/** Marks the row seen, or unseen if it reads reviewed. */
export function markSeen(row: ComparisonReview, at: string): ReviewCommand {
  return {
    kind: "set-seen",
    comparison: comparisonOf(row),
    seen: row.review.state !== "reviewed",
    at,
  };
}

/** Marks one file of a row viewed, or not viewed if it is. */
export function markViewed(
  row: ComparisonReview,
  file: FileVersion,
  at: string,
): ReviewCommand {
  return {
    kind: "set-viewed",
    reviewKey: row.reviewKey,
    file,
    viewed: !isViewed(row.viewed, file),
    at,
  };
}

/** Adds a comment on a row, pinned to the commit what it is about was read
 *  against. */
export function commentOn(
  row: ComparisonReview,
  comment: Anchor & Pick<Comment, "id" | "body" | "createdAt" | "author">,
): ReviewCommand {
  // The before side of a comparison of two commits is the `from` commit's
  // own tree, which is what an after-side anchor on that commit names. A
  // before-side anchor is left meaning the parent's tree, as it does on a
  // commit's own diff.
  const onFrom =
    comment.kind === "line" &&
    comment.side === "before" &&
    row.fromCommitId !== null &&
    row.toCommitId !== null;
  const commitId = onFrom
    ? row.fromCommitId
    : (row.toCommitId ?? row.fromCommitId);
  return {
    kind: "add-comment",
    comment: {
      ...comment,
      ...(onFrom && { side: "after" as const }),
      reviewKey: row.reviewKey,
      commitId: commitId ?? "",
      resolved: false,
      replies: [],
    },
  };
}

/** What writing on a row records first, so its key outlives the row. */
export function keepKey(row: ComparisonReview): ReviewCommand[] {
  return row.keeps === null
    ? []
    : [{ kind: "set-key", commitId: row.keeps, reviewKey: row.reviewKey }];
}
// ~/~ end
