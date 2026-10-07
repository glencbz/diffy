# Review

What the reader has looked at, what changed since, and where that is kept.

## Review state

`/api/interdiff` never learns review state exists: every row costs a jj
process, so a mark must not trigger a refetch. The review document loads on
its own, and rows are matched to it client-side by ids both already carry.

**Keys.** `reviewKey` uses the after commit (the version being approved),
else the before. `change:<id>` survives an amend; `rev:<commit id>`, for a
commit with no change id, does not, so a rewrite makes the row read `unseen`,
never falsely `reviewed`. The prefixes keep the two id spaces apart in one
field.

**Marks** are the triple `(reviewKey, fromCommitId, toCommitId)`, because
`alignSeries` can give one change id two rows (a reorder is a drop plus an
insert of the same change). `reviewed` needs the exact triple. `changed`
needs a mark that shares a side (an amend moved the after side, a rebase the
before) or fills the same sides (a rebase that moved both); together these
leave only a reorder's two halves unrelated, as they must be.

**Comments** are anchored to a line on one side, a file, or the whole
comparison. The anchor's fields sit on the comment itself so line comments
stored before the other anchors existed still parse. A comment is stale when
it was written against any commit but the one the row shows, the same rule
for every anchor. A comment on the row's `from` commit is about the version
the row compares against, so counting it current would label it with a line
the newer commit may have moved.

A line anchor counts lines of one tree: an after-side anchor its commit's,
a before-side one its parent's, the meaning the agent's `comment` tool gives
it too. `commentOn` keeps to that, so a line on the before side of an
interdiff is written as an after-side line of the `from` commit.

`numberedOn` says which side of a row, if either, draws the anchor's tree,
and `drawnAt` follows a line from the before side through the file's patch:
to where the newer commit keeps it, or to the removed line where it rewrote
it. The interdiff rebases `from` onto `to`'s parent, so a parent that changed
lines above the anchor shifts it by that much unseen.

A comment two versions
back is on neither side and is listed at the line it was written on. Following
it would need a diff from its commit to the row's, which the row does not
fetch; storing the line's text and searching for it would find the wrong one
of two equal lines.

**Threads.** A comment carries its replies, so the reader and an agent can
answer each other on one thread. Resolving, staleness and the open count stay
with the comment, and deleting it takes its replies along. A reply could
instead be a comment of its own naming the one it answers, but then every
count, filter and stale check would have to skip replies, and a reply would
carry an anchor and a resolution that mean nothing. `add-reply` to a comment
that is gone does nothing, as a retry would.

**Viewed files** are filed under the row's key and named by path and both
blobs, so an amend that leaves the file alone keeps it viewed and one that
touches it does not. A stale mark is left in place; a rewrite that restores
the blobs finds it again.

**Commands.** Every change is a `ReviewCommand` saying what the state should
become, never which way to flip, so a retry after a failure is harmless.
`applyCommand` is the only statement of what one does, run by the browser and
the [server](../backend/review-store.md) alike. The screen's toggles decide
the direction where the reader clicked.

**Pull request keys.** A pull request commit has no id that survives a force
push, so `pullRowKey` gives a row the key its before commit was last written
under, else `rev:` of its own commit. Writing on a row first sends `set-key`
(`keepKey`) for its own commit, so the next version's row inherits it, and a
hand-corrected pairing moves marks and comments with it. Keys are stored
rather than read off marks and comments, since viewed marks name no commit
and deleting the last comment would lose the key. `set-key` is its own
command so one command records one fact. Corrected pairings are kept too,
under the series and the two heads ([pairing](pairing.md#keeping-a-correction)).

**Local reviews** live here too, each a name and the
[versions](../backend/local-reviews.md) registered under it. `register` adds a
version, starting the review if there is none; a second registration at an
operation the review already has replaces that version, since it is the reader
correcting the first. `forget-review` only stamps a review forgotten, so
`restore-review` can bring it back with everything it kept; registering a
forgotten name brings it back too, since someone said it is ready again.
`purge-forgotten` drops the reviews forgotten before a time, with the reviewed
marks and corrected pairings kept under their series, so the name starts fresh
after that. The [server](../backend/review-store.md#dropping-forgotten-reviews)
sends it for reviews forgotten `KEEP_FORGOTTEN_MS` ago. Marks and comments on
a review's rows stay, since they are filed under change ids another review of
the same commits reads too.
A local review's row is filed by `localRowKey`, under its change id the way
`reviewKey` files one.

```ts
//| id: frontend-model-review
//| file: src/frontend/model/review.ts
import * as z from "zod";
import type { AsyncState } from "./asyncState";
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
    document.localReviews.length === 0
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
            : { ...comment, replies: [...comment.replies, command.reply] },
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
      };
    }
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
```

The reorder case runs `alignSeries` for real, since a hand-written fixture
could encode the same wrong assumption the code makes.

```ts
//| id: frontend-model-review-test
//| file: src/frontend/model/review.test.ts
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow } from "./diff";
import type { LogEntry } from "./history";
import {
  applyCommand,
  type Comment,
  commentOn,
  drawnAt,
  EMPTY_REVIEW,
  type FileVersion,
  isViewed,
  keepKey,
  keptPairing,
  localReview,
  localRowKey,
  localSeries,
  markSeen,
  markViewed,
  pullRowKey,
  type ReviewCommand,
  ReviewDocument,
  type ReviewedRow,
  reviewComparison,
  reviewKey,
  reviewRows,
} from "./review";

function logEntry(changeId: string, commitId: string): LogEntry {
  return { ...blank, changeId, commitId };
}

function gitLogEntry(commitId: string): LogEntry {
  return { ...blank, changeId: null, commitId };
}

const blank = {
  changeId: null,
  commitId: "",
  description: "",
  parents: [],
  author: "",
  timestamp: "2026-01-01T00:00:00Z",
  refs: [],
  markers: [],
} satisfies LogEntry;

function pairRow(
  changeId: string,
  fromCommitId: string,
  toCommitId: string,
): InterdiffRow {
  return {
    from: logEntry(changeId, fromCommitId),
    to: logEntry(changeId, toCommitId),
    files: [],
  };
}

describe("reviewRows", () => {
  test("leaves a row unseen against an empty document", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document = EMPTY_REVIEW;

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a row reviewed on an exact triple match", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("marks a row changed when the after side has moved on", () => {
    // arrange
    const row = pairRow("a", "a1", "a3");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when the before side has moved on", () => {
    // arrange
    const row = pairRow("a", "a0", "a2");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when a rebase moved both sides at once", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("leaves the other half of a reorder unseen, not changed", () => {
    // arrange
    const A = logEntry("aaaa", "a1");
    const B = logEntry("bbbb", "b1");
    const rows = alignSeries([A, B], [B, A]).map((pair) => ({
      ...pair,
      files: [],
    }));
    const changeARows = reviewRows(rows, EMPTY_REVIEW).filter(
      (row) => row.reviewKey === "change:aaaa",
    );
    const dropped = changeARows.find((row) => row.to === null);
    if (dropped === undefined) {
      throw new Error("expected a dropped row for change aaaa");
    }
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "change:aaaa",
          fromCommitId: dropped.from?.commitId ?? null,
          toCommitId: dropped.to?.commitId ?? null,
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const inserted = reviewRows(rows, document).find(
      (row) => row.reviewKey === "change:aaaa" && row.from === null,
    );

    // assert
    expect(rows).toHaveLength(3);
    expect(changeARows).toHaveLength(2);
    expect(inserted?.review).toEqual({ state: "unseen" });
  });

  test("flags a comment stale when its commit is on neither side of the row", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "line",
          path: "f.ts",
          side: "after",
          line: 3,
          commitId: "a0",
          body: "old",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
          author: "reader",
          replies: [],
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("flags a line comment stale but follows it while its commit is the row's before side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document = withComments(lineComment("a1", "after", 6));

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]).toMatchObject({
      stale: true,
      numberedOn: "before",
    });
  });

  test("numbers a before-side comment on the parent's tree, which only its own commit's diff draws", () => {
    // arrange
    const document = withComments(lineComment("a2", "before", 3));
    const alone = { from: null, to: logEntry("a", "a2"), files: [] };

    // act
    const [interdiff] = reviewRows([pairRow("a", "a1", "a2")], document);
    const [own] = reviewRows([alone], document);

    // assert
    expect(interdiff?.comments[0]).toMatchObject({
      stale: false,
      numberedOn: null,
    });
    expect(own?.comments[0]).toMatchObject({
      stale: false,
      numberedOn: "before",
    });
  });

  test("keeps a file comment fresh while its commit is the row's after side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "file",
          path: "f.ts",
          commitId: "a2",
          body: "split this file",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
          author: "reader",
          replies: [],
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(false);
  });

  test("flags a comparison comment stale once both sides have been rewritten", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "comparison",
          commitId: "a2",
          body: "squash this into its parent",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
          author: "reader",
          replies: [],
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("marks a change-id-less row reviewed on an exact triple match", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("reads unseen, not reviewed or changed, once a change-id-less row's identifying commit is rewritten", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2-rewritten"),
      files: [],
    };
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a change-id-less row changed when the other side has moved on", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1-new"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: ReviewDocument = {
      ...EMPTY_REVIEW,
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "g1",
      seenTo: "g2",
    });
  });
});

describe("ReviewDocument", () => {
  test("reads a comment stored without a kind or a side as an after-side line comment", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          path: "f.ts",
          line: 3,
          commitId: "a2",
          body: "written before sides",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const document = ReviewDocument.parse(stored);

    // assert
    expect(document.comments[0]).toMatchObject({
      kind: "line",
      path: "f.ts",
      side: "after",
      line: 3,
    });
  });

  test("reads a comment kept before comments had authors as the reader's", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "comparison",
          commitId: "a2",
          body: "written before authors",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const document = ReviewDocument.parse(stored);

    // assert
    expect(document.comments[0]?.author).toBe("reader");
  });

  test("reads a comment kept before threads as one with no replies", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "comparison",
          commitId: "a2",
          body: "written before threads",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
          author: "reader",
        },
      ],
    };

    // act
    const document = ReviewDocument.parse(stored);

    // assert
    expect(document.comments[0]?.replies).toEqual([]);
  });

  test("reads file and comparison comments back as themselves", () => {
    // arrange
    const written = {
      reviewKey: "change:a",
      commitId: "a2",
      body: "",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
      author: "agent",
      replies: [
        {
          id: "r1",
          body: "",
          createdAt: "2026-09-14T10:00:00.000Z",
          author: "reader",
        },
      ],
    };
    const stored = {
      marks: [],
      comments: [
        { ...written, id: "c1", kind: "file" as const, path: "f.ts" },
        { ...written, id: "c2", kind: "comparison" as const },
      ],
    };

    // act
    const document = ReviewDocument.parse(stored);

    // assert
    expect(document.comments).toEqual(stored.comments);
  });

  test("rejects a file comment with no path", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "file",
          commitId: "a2",
          body: "",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const parsed = ReviewDocument.safeParse(stored);

    // assert
    expect(parsed.success).toBe(false);
  });
});

describe("reviewKey", () => {
  test("keeps a jj row and a git row apart even when the literal id matches", () => {
    // arrange
    const jjRow: InterdiffRow = {
      from: null,
      to: logEntry("shared", "c1"),
      files: [],
    };
    const gitRow: InterdiffRow = {
      from: null,
      to: gitLogEntry("shared"),
      files: [],
    };

    // act
    const jjKey = reviewKey(jjRow);
    const gitKey = reviewKey(gitRow);

    // assert
    expect(jjKey).toBe("change:shared");
    expect(gitKey).toBe("rev:shared");
    expect(jjKey).not.toBe(gitKey);
  });
});

const empty = EMPTY_REVIEW;

function lineComment(
  commitId: string,
  side: "before" | "after",
  line: number,
): Comment {
  return {
    id: `c-${commitId}-${side}-${line}`,
    reviewKey: "change:a",
    kind: "line",
    path: "math.js",
    side,
    line,
    commitId,
    body: "divides by zero",
    resolved: false,
    createdAt: "2026-10-06T09:00:00.000Z",
    author: "reader",
    replies: [],
  };
}

function withComments(...comments: Comment[]): ReviewDocument {
  return { ...EMPTY_REVIEW, comments };
}

function reviewedRow(row: InterdiffRow, document: ReviewDocument): ReviewedRow {
  const [reviewed] = reviewRows([row], document);
  if (reviewed === undefined) throw new Error("no row");
  return reviewed;
}

/** Each command in turn, as the server and the browser both apply them. */
function applied(
  document: ReviewDocument,
  ...commands: ReviewCommand[]
): ReviewDocument {
  return commands.reduce(applyCommand, document);
}

describe("viewed files", () => {
  const file: FileVersion = { path: "f.ts", oldBlob: "b1", newBlob: "b2" };
  const row = pairRow("a", "a1", "a2");

  test("reads a file viewed on its row once it is marked", () => {
    // arrange
    const document = applied(
      empty,
      markViewed(reviewedRow(row, empty), file, "2026-09-25T09:00:00Z"),
    );

    // act
    const viewed = reviewedRow(row, document).viewed;

    // assert
    expect(isViewed(viewed, file)).toBe(true);
  });

  test("unmarks a file marked a second time", () => {
    // arrange
    const marked = applied(
      empty,
      markViewed(reviewedRow(row, empty), file, "2026-09-25T09:00:00Z"),
    );

    // act
    const unmarked = applied(
      marked,
      markViewed(reviewedRow(row, marked), file, "2026-09-25T09:01:00Z"),
    );

    // assert
    expect(unmarked.viewed).toEqual([]);
  });

  test("reads a file not viewed once its after side has changed", () => {
    // arrange
    const document = applied(
      empty,
      markViewed(reviewedRow(row, empty), file, "2026-09-25T09:00:00Z"),
    );

    // act
    const viewed = reviewedRow(pairRow("a", "a1", "a3"), document).viewed;

    // assert
    expect(isViewed(viewed, { ...file, newBlob: "b3" })).toBe(false);
  });

  test("keeps a viewed mark to the row it was made on", () => {
    // arrange
    const document = applied(
      empty,
      markViewed(reviewedRow(row, empty), file, "2026-09-25T09:00:00Z"),
    );

    // act
    const viewed = reviewedRow(pairRow("b", "b1", "b2"), document).viewed;

    // assert
    expect(isViewed(viewed, file)).toBe(false);
  });
});

describe("changes to the document", () => {
  test("marks a row seen, and reads it reviewed", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");

    // act
    const document = applied(
      empty,
      markSeen(reviewedRow(row, empty), "2026-09-25T09:00:00Z"),
    );

    // assert
    expect(reviewedRow(row, document).review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-25T09:00:00Z",
    });
  });

  test("unmarks a reviewed row", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const marked = applied(
      empty,
      markSeen(reviewedRow(row, empty), "2026-09-25T09:00:00Z"),
    );

    // act
    const document = applied(
      marked,
      markSeen(reviewedRow(row, marked), "2026-09-25T09:01:00Z"),
    );

    // assert
    expect(document.marks).toEqual([]);
  });

  test("keeps the old mark when a changed row is marked again", () => {
    // arrange
    const marked = applied(
      empty,
      markSeen(
        reviewedRow(pairRow("a", "a1", "a2"), empty),
        "2026-09-25T09:00:00Z",
      ),
    );
    const amended = pairRow("a", "a1", "a3");

    // act
    const document = applied(
      marked,
      markSeen(reviewedRow(amended, marked), "2026-09-25T09:01:00Z"),
    );

    // assert
    expect(document.marks.map((mark) => mark.toCommitId)).toEqual(["a2", "a3"]);
    expect(reviewedRow(amended, document).review.state).toBe("reviewed");
  });

  test("pins a comment to the commit whose tree the side it was left on draws", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const at = {
      kind: "line",
      path: "f.ts",
      line: 3,
      body: "hm",
      createdAt: "t",
      author: "reader",
    } as const;

    // act
    const document = applied(
      empty,
      commentOn(row, { ...at, id: "c1", side: "before" }),
      commentOn(row, { ...at, id: "c2", side: "after" }),
    );

    // assert
    expect(
      document.comments.map((comment) =>
        comment.kind === "line" ? [comment.commitId, comment.side] : null,
      ),
    ).toEqual([
      ["a1", "after"],
      ["a2", "after"],
    ]);
  });

  test("pins a comment on a lone row to its one commit, either side", () => {
    // arrange
    const row = reviewedRow(
      { from: null, to: logEntry("a", "a2"), files: [] },
      empty,
    );

    // act
    const document = applied(
      empty,
      commentOn(row, {
        id: "c1",
        kind: "line",
        path: "f.ts",
        side: "before",
        line: 3,
        body: "hm",
        createdAt: "t",
        author: "reader",
      }),
    );

    // assert
    expect(document.comments[0]?.commitId).toBe("a2");
  });

  test("pins a file or comparison comment to the row's after side", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const at = { body: "hm", createdAt: "t", author: "reader" };

    // act
    const document = applied(
      empty,
      commentOn(row, { ...at, id: "c1", kind: "file", path: "f.ts" }),
      commentOn(row, { ...at, id: "c2", kind: "comparison" }),
    );

    // assert
    expect(document.comments.map((comment) => comment.commitId)).toEqual([
      "a2",
      "a2",
    ]);
  });

  test("resolves, then drops, one comment and leaves the other", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const at = {
      kind: "line",
      path: "f.ts",
      line: 3,
      side: "after",
      body: "hm",
      author: "reader",
    } as const;
    const two = applied(
      empty,
      commentOn(row, { ...at, id: "c1", createdAt: "t1" }),
      commentOn(row, { ...at, id: "c2", createdAt: "t2" }),
    );

    // act
    const resolved = applied(two, {
      kind: "resolve-comment",
      id: "c1",
      resolved: true,
    });
    const dropped = applied(resolved, { kind: "delete-comment", id: "c1" });

    // assert
    expect(resolved.comments.map((comment) => comment.resolved)).toEqual([
      true,
      false,
    ]);
    expect(dropped.comments.map((comment) => comment.id)).toEqual(["c2"]);
  });

  test("rewrites one comment's body and leaves the rest of it", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const written = applied(
      empty,
      commentOn(row, {
        id: "c1",
        kind: "comparison",
        body: "hm",
        createdAt: "t",
        author: "reader",
      }),
    );

    // act
    const edited = applied(written, {
      kind: "edit-comment",
      id: "c1",
      body: "looks good",
    });

    // assert
    expect(edited.comments).toEqual(
      written.comments.map((comment) => ({ ...comment, body: "looks good" })),
    );
  });

  test("threads a reply under its comment, and ignores one whose comment is gone", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const one = applied(
      empty,
      commentOn(row, {
        id: "c1",
        kind: "comparison",
        body: "why?",
        createdAt: "t1",
        author: "reader",
      }),
    );
    const reply = {
      id: "r1",
      body: "because",
      createdAt: "t2",
      author: "claude",
    };

    // act
    const answered = applied(one, {
      kind: "add-reply",
      commentId: "c1",
      reply,
    });
    const orphan = applied(one, {
      kind: "add-reply",
      commentId: "gone",
      reply,
    });

    // assert
    expect(answered.comments).toHaveLength(1);
    expect(answered.comments[0]?.replies).toEqual([reply]);
    expect(orphan).toEqual(one);
  });
  test("leaves the document of one application when a command lands twice", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const file: FileVersion = { path: "f.ts", oldBlob: "b1", newBlob: "b2" };
    const commands: ReviewCommand[] = [
      markSeen(row, "t"),
      markViewed(row, file, "t"),
      commentOn(row, {
        id: "c1",
        kind: "comparison",
        body: "hm",
        createdAt: "t",
        author: "reader",
      }),
      { kind: "edit-comment", id: "c1", body: "fine" },
      { kind: "resolve-comment", id: "c1", resolved: true },
      {
        kind: "add-reply",
        commentId: "c1",
        reply: { id: "r1", body: "ok", createdAt: "t", author: "claude" },
      },
    ];

    // act
    const once = applied(empty, ...commands);
    const twice = applied(
      empty,
      ...commands.flatMap((command) => [command, command]),
    );

    // assert
    expect(twice).toEqual(once);
  });
});

describe("reviewed versions", () => {
  test("keeps every version marked, once each", () => {
    // arrange
    const mark = (version: string, at: string): ReviewCommand => ({
      kind: "mark-reviewed",
      series: "pull:o/r#7",
      version,
      at,
    });

    // act
    const document = applied(
      empty,
      mark("v1", "t1"),
      mark("v2", "t2"),
      mark("v1", "t3"),
    );

    // assert
    expect(document.reviewed).toEqual([
      { series: "pull:o/r#7", version: "v1", reviewedAt: "t1" },
      { series: "pull:o/r#7", version: "v2", reviewedAt: "t2" },
    ]);
  });
});

describe("import", () => {
  const row = pairRow("a", "a1", "a2");
  const comment = {
    id: "c1",
    kind: "comparison",
    body: "hm",
    createdAt: "t",
    author: "reader",
  } as const;

  test("adds what the document lacks and keeps what it has", () => {
    // arrange
    const held = applied(empty, markSeen(reviewedRow(row, empty), "t-held"));
    const incoming = applied(
      empty,
      markSeen(reviewedRow(row, empty), "t-incoming"),
      commentOn(reviewedRow(row, empty), comment),
    );

    // act
    const document = applied(held, { kind: "import", document: incoming });

    // assert
    expect(document.marks.map((mark) => mark.seenAt)).toEqual(["t-held"]);
    expect(document.comments.map((kept) => kept.id)).toEqual(["c1"]);
  });

  test("leaves the document of one import when it lands twice", () => {
    // arrange
    const incoming = applied(
      empty,
      markSeen(reviewedRow(row, empty), "t"),
      commentOn(reviewedRow(row, empty), comment),
      { kind: "mark-reviewed", series: "pull:o/r#7", version: "v1", at: "t" },
    );
    const command: ReviewCommand = { kind: "import", document: incoming };

    // act
    const once = applied(empty, command);
    const twice = applied(empty, command, command);

    // assert
    expect(twice).toEqual(once);
    expect(once).toEqual(incoming);
  });
});
describe("pullRowKey", () => {
  const kept = (commitId: string, reviewKey: string): ReviewCommand => ({
    kind: "set-key",
    commitId,
    reviewKey,
  });

  test("starts a key from the row's own commit when nothing was kept", () => {
    // arrange
    // act
    // assert
    expect(pullRowKey(empty, "b1", "a1")).toEqual({
      reviewKey: "rev:a1",
      keeps: "a1",
    });
    expect(pullRowKey(empty, "b1", null)).toEqual({
      reviewKey: "rev:b1",
      keeps: "b1",
    });
  });

  test("takes the key its before commit was written on under", () => {
    // arrange
    const document = applied(empty, kept("a1", "rev:a0"));

    // act
    // assert
    expect(pullRowKey(document, "a1", "a2").reviewKey).toBe("rev:a0");
  });

  test("moves with the pairing, not with the commit", () => {
    // arrange
    const document = applied(
      empty,
      kept("a1", "rev:a1"),
      kept("b1", "rev:b1"),
      kept("a2", "rev:a1"),
    );

    // act
    const repaired = pullRowKey(document, "b1", "a2");

    // assert
    expect(repaired.reviewKey).toBe("rev:b1");
  });

  test("keeps a row with nothing before it on its own commit's key", () => {
    // arrange
    const document = applied(empty, kept("a2", "rev:a1"));

    // act
    // assert
    expect(pullRowKey(document, null, "a2").reviewKey).toBe("rev:a1");
  });

  test("carries a comment through a force push once the row is written on", () => {
    // arrange
    const v1 = pullRowKey(empty, null, "a1");
    const row = reviewComparison(empty, v1.reviewKey, null, "a1", v1.keeps);
    const document = applied(
      empty,
      ...keepKey(row),
      commentOn(row, {
        id: "c1",
        kind: "comparison",
        body: "hm",
        createdAt: "t",
        author: "reader",
      }),
    );

    // act
    const v2 = pullRowKey(document, "a1", "a2");
    const next = reviewComparison(document, v2.reviewKey, "a1", "a2", v2.keeps);

    // assert
    expect(next.comments.map((comment) => comment.id)).toEqual(["c1"]);
    expect(next.comments[0]?.stale).toBe(true);
  });
});
describe("kept pairings", () => {
  const heads = { series: "pull:o/r#7", before: "h1", after: "h2" };
  const slots = [{ left: "a1", right: "a2" }];

  test("keeps one pairing per pair of heads, and forgets it on null", () => {
    // arrange
    const set = (kept: typeof slots | null): ReviewCommand => ({
      kind: "set-pairing",
      ...heads,
      slots: kept,
    });

    // act
    const twice = applied(empty, set(slots), set([]), set(slots));
    const reset = applied(twice, set(null));

    // assert
    expect(twice.pairings).toEqual([{ ...heads, slots }]);
    expect(keptPairing(twice, heads)).toEqual(slots);
    expect(keptPairing(twice, { ...heads, after: "h3" })).toBeNull();
    expect(keptPairing(reset, heads)).toBeNull();
  });
});
describe("registered local reviews", () => {
  const version = (operation: string, revset: string) => ({
    operation,
    revset,
    commits: ["c"],
    registeredAt: "t",
  });
  const register = (name: string, operation: string, revset: string) =>
    ({
      kind: "register",
      name,
      version: version(operation, revset),
    }) satisfies ReviewCommand;

  test("adds a version per operation, and replaces one at the same operation", () => {
    // arrange
    // act
    const document = applied(
      empty,
      register("x", "o1", "trunk()..x"),
      register("x", "o2", "trunk()..x"),
      register("x", "o2", "trunk()..y"),
      register("other", "o1", "trunk()..o"),
    );

    // assert
    expect(document.localReviews).toEqual([
      {
        name: "x",
        versions: [version("o1", "trunk()..x"), version("o2", "trunk()..y")],
      },
      { name: "other", versions: [version("o1", "trunk()..o")] },
    ]);
  });

  /** Reviews "x" and "other", each with a version marked reviewed, and a
   *  pairing kept under "x". */
  const kept = () =>
    applied(
      empty,
      register("x", "o1", "trunk()..x"),
      register("other", "o1", "trunk()..o"),
      {
        kind: "mark-reviewed",
        series: localSeries("x"),
        version: "1",
        at: "t",
      },
      {
        kind: "mark-reviewed",
        series: localSeries("other"),
        version: "1",
        at: "t",
      },
      {
        kind: "set-pairing",
        series: localSeries("x"),
        before: "1",
        after: "2",
        slots: [],
      },
    );

  test("forgets a review without dropping what it kept", () => {
    // arrange
    const document = kept();

    // act
    const forgotten = applied(
      document,
      { kind: "forget-review", name: "x", at: "t1" },
      { kind: "forget-review", name: "x", at: "t2" },
    );

    // assert
    expect(
      forgotten.localReviews.map(({ name, forgottenAt }) => [
        name,
        forgottenAt,
      ]),
    ).toEqual([
      ["x", "t1"],
      ["other", undefined],
    ]);
    expect(forgotten.reviewed).toEqual(document.reviewed);
    expect(forgotten.pairings).toEqual(document.pairings);
  });

  test("restores a forgotten review as it was", () => {
    // arrange
    const document = kept();

    // act
    const restored = applied(
      document,
      { kind: "forget-review", name: "x", at: "t1" },
      { kind: "restore-review", name: "x" },
    );

    // assert
    expect(restored).toEqual(document);
  });

  test("restores a forgotten review registered again", () => {
    // arrange
    const forgotten = applied(kept(), {
      kind: "forget-review",
      name: "x",
      at: "t1",
    });

    // act
    const document = applied(forgotten, register("x", "o2", "trunk()..x"));

    // assert
    expect(localReview(document, "x")).toEqual({
      name: "x",
      versions: [version("o1", "trunk()..x"), version("o2", "trunk()..x")],
    });
  });

  test("purges reviews forgotten before a time, with what their series kept", () => {
    // arrange
    const forgotten = applied(
      kept(),
      { kind: "forget-review", name: "x", at: "2026-10-01T00:00:00.000Z" },
      { kind: "forget-review", name: "other", at: "2026-10-05T00:00:00.000Z" },
    );

    // act
    const purged = applied(forgotten, {
      kind: "purge-forgotten",
      before: "2026-10-03T00:00:00.000Z",
    });

    // assert
    expect(purged.localReviews.map((review) => review.name)).toEqual(["other"]);
    expect(purged.reviewed.map((version) => version.series)).toEqual([
      localSeries("other"),
    ]);
    expect(purged.pairings).toEqual([]);
  });
});
describe("localRowKey", () => {
  test("files a row under its change id, whichever side holds it", () => {
    const before = { commitId: "b1", changeId: "kx" };
    const after = { commitId: "a1", changeId: "kx" };

    expect(localRowKey(before, after).reviewKey).toBe("change:kx");
    expect(localRowKey(before, null).reviewKey).toBe("change:kx");
  });

  test("falls back to the commit when it has no change id", () => {
    expect(localRowKey(null, { commitId: "a1", changeId: null })).toEqual({
      reviewKey: "rev:a1",
      keeps: null,
    });
  });
});

describe("drawnAt", () => {
  // `return a / b;` is line 6 of v1 and line 7 of v2, where a guard is
  // inserted above it and line 5 is rewritten.
  const interdiff = [
    "@@ -4,3 +4,4 @@",
    " function divide(a, b) {",
    "-  // b is never 0",
    "+  // b can be 0",
    "+  if (b === 0) throw new RangeError();",
    "   return a / b;",
    "",
  ].join("\n");

  function drawn(comment: Comment) {
    const [row] = reviewRows([pairRow("a", "a1", "a2")], withComments(comment));
    const [read] = row?.comments ?? [];
    if (read === undefined) throw new Error("the comment is not on the row");
    return drawnAt(read, interdiff);
  }

  test("follows a line the newer commit keeps to where it now is", () => {
    expect(drawn(lineComment("a1", "after", 6))).toEqual({
      side: "after",
      line: 7,
    });
  });

  test("leaves a line the newer commit rewrites on the before side", () => {
    expect(drawn(lineComment("a1", "after", 5))).toEqual({
      side: "before",
      line: 5,
    });
  });

  test("draws a comment on the shown commit where it was written", () => {
    expect(drawn(lineComment("a2", "after", 6))).toEqual({
      side: "after",
      line: 6,
    });
  });

  test("draws nowhere a comment from a commit the row does not show", () => {
    expect(drawn(lineComment("a0", "after", 6))).toBeNull();
  });
});
```

`--review-open`, `--review-resolved`, and `--review-stale` are shared by a
comparison's tone chip and a comment thread's accent. A thread is a card: its
head says what the whole conversation is about and holds resolve, and every
message under it, the comment or a reply, gets the same byline. Replies sit
at the comment's indent rather than under it, so a long back and forth does
not creep across a narrow screen.

```css
/*| id: design-review-state
@layer components {
  .review-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-large);
    font-size: var(--text-size-small);
  }

  .review-chip--resolved {
    background: var(--review-seen-surface);
    color: var(--review-resolved);
    border: 1px solid var(--review-seen-border);
  }

  .review-chip--stale {
    background: var(--review-changed-surface);
    color: var(--review-stale);
    border: 1px solid var(--review-changed-border);
  }

  .review-chip--open {
    background: var(--review-open-surface);
    color: var(--review-open);
    border: 1px solid var(--review-open-border);
  }

  .comment-thread {
    margin: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-left: var(--border-width-accent) solid var(--review-open);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .comment-thread--resolved {
    border-left-color: var(--review-resolved);
  }

  .comment-thread--stale {
    border-left-color: var(--review-stale);
  }

  .comment-thread__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-faint);
    background: var(--surface-raised);
  }

  .comment-thread__where {
    flex: 1;
    color: var(--text-muted);
  }

  /* A folded thread's whole line opens it. */
  .comment-thread__summary {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: none;
    font: inherit;
    color: var(--text-faint);
    text-align: left;
    cursor: pointer;
  }

  .comment-thread__summary:hover {
    color: var(--text);
  }

  .comment-thread__excerpt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .comment-thread__stale {
    padding: var(--space-2) var(--space-4);
    color: var(--review-stale);
    background: var(--review-changed-surface);
  }

  .comment-thread__message {
    padding: var(--space-3) var(--space-4);
  }

  .comment-thread__message + .comment-thread__message {
    border-top: 1px solid var(--border-subtle);
  }

  .comment-thread__byline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
    margin-bottom: var(--space-1);
    color: var(--text-faint);
  }

  .comment-thread__author {
    color: var(--text);
    font-weight: 600;
  }

  .comment-thread__author--other {
    color: var(--accent);
  }

  .comment-thread__actions {
    display: flex;
    gap: var(--space-4);
    margin-left: auto;
  }

  .comment-thread__action {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
  }

  .comment-thread__action:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .comment-thread__body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .comment-thread__foot {
    border-top: 1px solid var(--border-subtle);
  }

  /* Looks like the field it opens into. */
  .comment-thread__start-reply {
    display: block;
    width: calc(100% - 2 * var(--space-4));
    margin: var(--space-3) var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font: inherit;
    color: var(--text-ghost);
    text-align: left;
    cursor: text;
  }
}
```
## The review bar

The review bar says in one line whether a row was looked at, whether it
moved since, how many comments are open, and how many files are viewed. The
`mark seen` button reads its label off the row's state. Without a review
document the bar keeps the chips and drops the buttons, which come and go
together, so a `ReviewBarVariant` either carries both handlers or neither.

```tsx
//| id: frontend-view-review-bar
//| file: src/frontend/views/ReviewBar.tsx
import type { ReactNode } from "react";
import { fileVersionOf } from "../model/changedFiles";
import type { FileDiff } from "../model/diff";
import {
  type ComparisonReview,
  isViewed,
  type ReviewBarVariant,
  type RowReview,
} from "../model/review";

/** Where the reader stands on one comparison, and the two things they can do
 *  about the whole of it. */
export function ReviewBar({
  review,
  files,
  commentLabel,
  variant,
}: {
  review: ComparisonReview;
  files: FileDiff[];
  commentLabel: string;
  variant: ReviewBarVariant;
}) {
  const openComments = review.comments.filter(
    (comment) => !comment.resolved,
  ).length;
  const viewed = files.filter((file) =>
    isViewed(review.viewed, fileVersionOf(file)),
  ).length;

  return (
    <div className="review-bar">
      <ReviewChip review={review.review} />
      {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
      {files.length > 0 && (
        <span className="review-bar__viewed">
          {viewed} / {files.length} files viewed
        </span>
      )}
      {variant.kind === "writable" && (
        <>
          <button
            type="button"
            onClick={variant.onMarkSeen}
            className="review-bar__mark-seen"
          >
            {review.review.state === "reviewed" ? "mark unseen" : "mark seen"}
          </button>
          <button
            type="button"
            onClick={variant.onComment}
            className="review-bar__comment"
          >
            {commentLabel}
          </button>
        </>
      )}
    </div>
  );
}

function ReviewChip({ review }: { review: RowReview }) {
  if (review.state === "unseen") return null;
  return review.state === "reviewed" ? (
    <Chip tone="reviewed">reviewed</Chip>
  ) : (
    <Chip tone="changed">changed since you looked</Chip>
  );
}

const TONE_CLASS: Record<"reviewed" | "changed" | "open", string> = {
  reviewed: "review-chip--resolved",
  changed: "review-chip--stale",
  open: "review-chip--open",
};

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  return <span className={`review-chip ${TONE_CLASS[tone]}`}>{children}</span>;
}
```

```css
/*| id: design-review-state
@layer components {
  .review-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .review-bar__viewed {
    color: var(--text-muted);
  }

  .review-bar__mark-seen,
  .review-bar__comment {
    font: inherit;
  }
}
```

## Storage

The review document lives in the [review store](../backend/review-store.md),
so it arrives after the screen does and a write can fail.

### Reading it from the server

`reviewStore` is the document's repository in `persistence/`, like
`localRepository` for [settings](settings.md); `state/review.ts` talks to a
repository either way. A refusal comes back as an `Error` with the server's
message.

```ts
//| id: frontend-persistence-review
//| file: src/frontend/persistence/review.ts
import * as z from "zod";
import { type ReviewCommand, ReviewSnapshot } from "../model/review";

const ErrorAnswer = z.object({ error: z.string() });

/** The server's answer, or the error it gave in its place. */
async function snapshotOf(res: Response): Promise<ReviewSnapshot> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = ErrorAnswer.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error
        : `the review store answered ${res.status}`,
    );
  }
  return ReviewSnapshot.parse(body);
}

/** The review document as the server keeps it. */
export const reviewStore = {
  async load(): Promise<ReviewSnapshot> {
    return snapshotOf(await fetch("/api/review"));
  },
  async send(command: ReviewCommand): Promise<ReviewSnapshot> {
    return snapshotOf(
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
    );
  },
  /** Calls `onChange` with each revision the server announces, and once
   *  each time the socket opens, since a write may have landed while it
   *  was closed. Reconnects until the returned function is called. */
  watch(onChange: (revision: number | null) => void): () => void {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const url = new URL("/api/review/changes", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const connect = () => {
      socket = new WebSocket(url);
      socket.onopen = () => onChange(null);
      socket.onmessage = (event) => {
        const change = Change.safeParse(JSON.parse(String(event.data)));
        if (change.success) onChange(change.data.revision);
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  },
};

const Change = z.object({ revision: z.number().int() });
```

### Holding it while it changes

`useReview` loads the document once for the app. While `loading` or
`unavailable` the document is empty and the diff draws without review state;
only a `ready` handle has `actions`, so nothing can offer to write.

Each command applies on screen at once: the screen shows the server's last
document with every in-flight command applied on top. An answer replaces the
server's document and drops its command; a failure drops the command, which
restores what the server holds, and sets `failure`. Restoring a snapshot
from before the change would also undo later changes that landed.

A revision announced over [the WebSocket](../backend/review-store.md#telling-screens-about-changes),
or the socket (re)opening, rereads the document. In-flight commands stay on
top of it.

```tsx
//| id: frontend-state-review
//| file: src/frontend/state/review.ts
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AsyncState } from "../model/asyncState";
import {
  applyCommand,
  type ComparisonReview,
  commentOn,
  EMPTY_REVIEW,
  keepKey,
  markSeen,
  markViewed,
  type ReviewActions,
  type ReviewCommand,
  type ReviewDocument,
  type ReviewSnapshot,
} from "../model/review";
import { clearLegacyReview, legacyReview } from "../persistence/legacyReview";
import { reviewStore } from "../persistence/review";

/** The review document and what a screen can do with it. Only a document
 *  the server has answered with can be changed, so `actions` exists only
 *  once it is ready. */
export type ReviewHandle = (
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; actions: ReviewActions }
) & {
  /** The server's document with every command still in flight applied. */
  document: ReviewDocument;
  /** Why the last change could not be saved, until the reader dismisses it. */
  failure: string | null;
  dismissFailure: () => void;
};

interface Pending {
  id: number;
  command: ReviewCommand;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useReview(): ReviewHandle {
  const [confirmed, setConfirmed] = useState<AsyncState<ReviewSnapshot>>({
    status: "loading",
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const nextId = useRef(0);

  // Answers can arrive out of order, and an older one would undo a newer
  // one's command on screen, so only a higher revision replaces what is held.
  const accept = useCallback((snapshot: ReviewSnapshot) => {
    setConfirmed((now) =>
      now.status === "ready" && now.data.revision >= snapshot.revision
        ? now
        : { status: "ready", data: snapshot },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot = await reviewStore.load();
      const legacy = legacyReview(new Date().toISOString());
      if (legacy !== null) {
        snapshot = await reviewStore.send({ kind: "import", document: legacy });
        clearLegacyReview();
      }
      if (!cancelled) accept(snapshot);
    })().catch((error: unknown) => {
      if (!cancelled) {
        setConfirmed({ status: "error", message: messageOf(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  // Another writer's change reaches this screen as an announced revision.
  // One this screen already holds needs no read.
  const held = confirmed.status === "ready" ? confirmed.data.revision : -1;
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(
    () =>
      reviewStore.watch((revision) => {
        if (revision !== null && revision <= heldRef.current) return;
        reviewStore.load().then(accept, () => {});
      }),
    [accept],
  );

  const actions = useMemo<ReviewActions>(() => {
    const now = () => new Date().toISOString();
    const send = (command: ReviewCommand) => {
      const id = nextId.current;
      nextId.current += 1;
      const settle = () =>
        setPending((all) => all.filter((entry) => entry.id !== id));
      setPending((all) => [...all, { id, command }]);
      reviewStore.send(command).then(
        (snapshot) => {
          accept(snapshot);
          settle();
        },
        (error: unknown) => {
          settle();
          setFailure(`Could not save that change: ${messageOf(error)}`);
        },
      );
    };
    const write = (row: ComparisonReview, command: ReviewCommand) => {
      for (const kept of keepKey(row)) send(kept);
      send(command);
    };
    return {
      markSeen: (row) => write(row, markSeen(row, now())),
      addComment: (row, anchor, body) =>
        write(
          row,
          commentOn(row, {
            id: crypto.randomUUID(),
            ...anchor,
            body,
            createdAt: now(),
            author: "reader",
          }),
        ),
      editComment: (id, body) => send({ kind: "edit-comment", id, body }),
      resolveComment: (id, resolved) =>
        send({ kind: "resolve-comment", id, resolved }),
      dropComment: (id) => send({ kind: "delete-comment", id }),
      replyToComment: (id, body) =>
        send({
          kind: "add-reply",
          commentId: id,
          reply: {
            id: crypto.randomUUID(),
            body,
            createdAt: now(),
            author: "reader",
          },
        }),
      toggleViewed: (row, file) => write(row, markViewed(row, file, now())),
      compare: (row, newPath, oldPath) =>
        write(row, {
          kind: "set-compared",
          reviewKey: row.reviewKey,
          newPath,
          oldPath,
        }),
      markReviewed: (series, version) =>
        send({ kind: "mark-reviewed", series, version, at: now() }),
      keepPairing: (series, before, after, slots) =>
        send({ kind: "set-pairing", series, before, after, slots }),
      forgetReview: (name) => send({ kind: "forget-review", name, at: now() }),
      restoreReview: (name) => send({ kind: "restore-review", name }),
    };
  }, [accept]);

  const dismissFailure = useCallback(() => setFailure(null), []);
  const shared = { failure, dismissFailure };

  if (confirmed.status === "loading") {
    return { status: "loading", document: EMPTY_REVIEW, ...shared };
  }
  if (confirmed.status === "error") {
    return {
      status: "unavailable",
      message: confirmed.message,
      document: EMPTY_REVIEW,
      ...shared,
    };
  }
  return {
    status: "ready",
    actions,
    document: pending.reduce(
      (document, entry) => applyCommand(document, entry.command),
      confirmed.data.document,
    ),
    ...shared,
  };
}
```

`App` holds the handle in `ReviewContext`; one per screen would reload on
every tab switch and lose in-flight commands. Reading it outside `App`
throws rather than drawing an empty review.

```tsx
//| id: frontend-state-review

export const ReviewContext = createContext<ReviewHandle | null>(null);

export function useReviewContext(): ReviewHandle {
  const review = useContext(ReviewContext);
  if (review === null) throw new Error("no ReviewContext above this screen");
  return review;
}
```

The strip under the tabs shows only when review state is missing or a change
was lost; a lost change stays until dismissed, since it is no longer on
screen anywhere else.

```tsx
//| id: frontend-view-review-strip
//| file: src/frontend/views/ReviewStrip.tsx
/** A line across the screen when review state cannot be shown or a change
 *  to it was lost. Nothing at all while it loads or once it has loaded. */
export function ReviewStrip({
  unavailable,
  failure,
  onDismiss,
}: {
  /** Why the review document could not be read, if it could not. */
  unavailable: string | null;
  /** Why the last change could not be saved, if it could not. */
  failure: string | null;
  onDismiss: () => void;
}) {
  if (unavailable === null && failure === null) return null;
  return (
    <div className="review-strip" role="status">
      {unavailable !== null && (
        <p className="review-strip__note">
          Review state is unavailable, so marks and comments are hidden:{" "}
          {unavailable}
        </p>
      )}
      {failure !== null && (
        <p className="review-strip__note">
          {failure}{" "}
          <button
            type="button"
            className="review-strip__dismiss"
            onClick={onDismiss}
          >
            dismiss
          </button>
        </p>
      )}
    </div>
  );
}
```

```css
/*| id: design-review-state
@layer components {
  .review-strip {
    flex: none;
    padding: var(--space-2) var(--space-5);
    border-bottom: 1px solid var(--review-changed-border);
    background: var(--review-changed-surface);
  }

  .review-strip__note {
    margin: 0;
  }

  .review-strip__dismiss {
    margin-left: var(--space-3);
  }
}
```

### Moving what the browser kept

`legacyReview` reads what older versions kept in `localStorage`
(`diffy.session.v1` and `diffy.last-reviewed.v1:` keys) into one document,
and `useReview` sends it as an `import` whenever the keys hold anything, then
clears them. An import adds only what the server lacks, so a repeat or a
second browser's import is harmless; importing only into an empty document
would drop every browser but the first. A last reviewed head is dated at the
import.

```ts
//| id: frontend-persistence-legacy-review
//| file: src/frontend/persistence/legacyReview.ts
import { LastReviewed } from "../model/lastReviewed";
import {
  EMPTY_REVIEW,
  isEmptyReview,
  ReviewDocument,
  type ReviewedVersion,
} from "../model/review";
import { localRepository } from "./local";

const SESSION_KEY = "diffy.session.v1";
const LAST_REVIEWED_PREFIX = "diffy.last-reviewed.v1:";

function lastReviewedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LAST_REVIEWED_PREFIX)) keys.push(key);
  }
  return keys;
}

/** What this browser kept of the review before the server did, as one
 *  document, or null when it kept nothing. A pull request's last reviewed
 *  head becomes a version marked reviewed at `now`, since the browser never
 *  kept when it was marked. */
export function legacyReview(now: string): ReviewDocument | null {
  const session = localRepository(
    SESSION_KEY,
    ReviewDocument,
    EMPTY_REVIEW,
  ).load();
  const reviewed = lastReviewedKeys().flatMap((key): ReviewedVersion[] => {
    const mark = localRepository(key, LastReviewed, null).load();
    if (mark === null) return [];
    const series = `pull:${key.slice(LAST_REVIEWED_PREFIX.length)}`;
    return [{ series, version: mark.head, reviewedAt: now }];
  });
  const document = { ...session, reviewed };
  return isEmptyReview(document) ? null : document;
}

/** Forgets what `legacyReview` read, once the server holds it. */
export function clearLegacyReview(): void {
  for (const key of [SESSION_KEY, ...lastReviewedKeys()]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Left behind, it is imported again next time, which changes nothing.
    }
  }
}
```

```ts
//| id: frontend-persistence-legacy-review-test
//| file: src/frontend/persistence/legacyReview.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { EMPTY_REVIEW } from "../model/review";
import { clearLegacyReview, legacyReview } from "./legacyReview";
import { memoryStorage } from "./memoryStorage";

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

const mark = {
  reviewKey: "change:a",
  fromCommitId: "a1",
  toCommitId: "a2",
  seenAt: "2026-09-14T09:00:00.000Z",
};
const head = "b".repeat(40);

describe("legacyReview", () => {
  test("reads nothing when the browser kept nothing", () => {
    // arrange
    // act
    // assert
    expect(legacyReview("now")).toBeNull();
  });

  test("reads the session and each pull request's head into one document", () => {
    // arrange
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [mark], comments: [] }),
    );
    localStorage.setItem(
      "diffy.last-reviewed.v1:o/r#7",
      JSON.stringify({ head }),
    );

    // act
    const document = legacyReview("now");

    // assert
    expect(document).toEqual({
      ...EMPTY_REVIEW,
      marks: [mark],
      reviewed: [{ series: "pull:o/r#7", version: head, reviewedAt: "now" }],
    });
  });

  test("keeps the comments of a session saved before comments had kinds", () => {
    // arrange
    const comment = {
      id: "c1",
      reviewKey: "change:a",
      path: "f.ts",
      line: 3,
      commitId: "a2",
      body: "written before kinds",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
    };
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [], comments: [comment] }),
    );

    // act
    // assert
    expect(legacyReview("now")?.comments).toEqual([
      {
        ...comment,
        kind: "line",
        side: "after",
        author: "reader",
        replies: [],
      },
    ]);
  });

  test("skips a pull request's head that does not parse", () => {
    // arrange
    localStorage.setItem("diffy.last-reviewed.v1:o/r#9", '{"head":"abc"}');

    // act
    // assert
    expect(legacyReview("now")).toBeNull();
  });
});

describe("clearLegacyReview", () => {
  test("forgets the review keys and leaves the settings", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", "{}");
    localStorage.setItem("diffy.last-reviewed.v1:o/r#7", "{}");
    localStorage.setItem("diffy.settings.v1", "{}");

    // act
    clearLegacyReview();

    // assert
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("diffy.settings.v1")).toBe("{}");
  });
});
```
