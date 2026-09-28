# Review

What the reader has already looked at, which of it has changed since, and
where the answer is kept between visits.

## Review state

`/api/interdiff` must never learn that review state exists. Every row it
returns costs a `jj` process, so a mark that triggered a refetch would spawn a
subprocess to record a click. The review document is read from
[the review store](#storage) on its own, independently of the interdiff fetch;
whichever row a mark or comment belongs to is worked out here, client-side,
from ids both already carry.

`reviewKey` picks `row.to ?? row.from`: the after side is the version being
approved, so when a row has a real after side that commit is the one whose
identity counts. `alignSeries` guarantees at least one side is present, so
only a row with neither side throws.

That commit's own id, not the row's, decides the key's shape: `change:${id}`
when it carries a jj change id, `rev:${id}` on its commit id when it does not.
A jj change id and a git commit id are drawn from different id spaces and
could collide as bare strings, so the prefix keeps a `change:` key and a
`rev:` key apart in the one `reviewKey` field a mark or comment is stored
under, with no schema change needed to say so.

The two kinds of key degrade differently. A change id survives an amend, so a
`change:` key still finds its row after the commit is rewritten, and
`reviewed` still reads `reviewed`. A `rev:` key names one exact revision, so
rewriting the commit it was built from changes the key outright and the row
reads `unseen`, never `reviewed`, because nothing durable was ever true about
that identity. That loses memory, but safely: a `rev:`-keyed row can never
falsely claim to have been reviewed. It stays useful in the one case that does
not require surviving a rewrite. If the identifying commit is untouched but
the other side of the comparison moves, the key is unchanged, the stored
triple no longer matches, and the row correctly reads `changed`.

A mark is identified by the full `(reviewKey, fromCommitId, toCommitId)`
triple, not by the review key alone. `alignSeries` can put one change id on
two rows in the same series, because a reorder is a drop and an insert of the
same change and both halves identify off the same surviving commit, so a mark
on one must not paint the other as reviewed or even as changed. They are
different comparisons that share an identity only by coincidence of the
algorithm. Reading takes the same care writing does: `reviewed` needs an exact
triple match, and `changed` needs more than a shared review key, or the same
bug resurfaces one layer up.

A mark counts toward `changed` when it fills the same sides as the row, or
when it shares one: the same `fromCommitId` because an amend moved the after
side, or the same `toCommitId` because a rebase moved the before side. Sharing
a side alone is not enough, because a rebase that rewrites both sides at once
shares neither, and reporting a change the reader has already looked at as
`unseen` loses the memory the review document exists to keep. Filling the same sides
alone is not enough either, because a change that was a modification and is
now a drop fills different slots while being the same thing the reader
reviewed. The two together leave exactly one pair unrelated, which is the pair
that has to be: the drop half of a reorder (`from: A, to: null`) and its
insert half (`from: null, to: A`) neither share a side nor fill the same
slots, so a mark on one leaves the other `unseen`. The insert is a comparison
the reader has never looked at.

A comment is about one of three things, and its `Anchor` says which: a line
on one `side` of a file, a whole file, or the whole comparison the row stands
for. The anchor's fields sit on the comment itself rather than under a field
of their own, so a line comment stored before files and comparisons took
comments is still a valid line comment: the `kind` it lacks defaults to
`line`, the way its missing `side` defaults to `after`. Nesting the anchor
would need a migration written in front of the schema, and a document that
fails to parse [cannot be read or written](../backend/review-store.md#the-document-as-one-row)
until someone repairs it, so a bug in that migration would cost every reader
their review state.

A comment's `stale` flag asks whether what the note is about still reads as
it did when the note was written, a narrower question than a mark's `changed`
state. Its `commitId` names the version it was read against, and it is stale
when neither of the row's current sides is that commit. The rule is the same
for every anchor. A file comment could instead stay fresh until the file's own
blob changed, which would spare it a rewrite that touched only other files,
but a line comment already goes stale on any rewrite of its commit, and a
second rule would need a second id on every comment to mean something
slightly different by the same word.

Which commit that is depends on the row. A paired row compares two commits, so
the after side is `to` and the before side is `from`. A lone row is one
commit's own diff against its parent, so that commit is the one version the
row names and it stands for both sides. `addComment` picks `from ?? to` for a
before-side line and `to ?? from` for everything else, since a file or a
comparison is read as the version being approved. The stale rule needs no side
of its own: a rewrite of either commit moves it off the row.

A viewed mark says the reader is done with one file of a row, as that file
reads now. It is filed under the row's review key, so it follows a change
through an amend the way a mark does, and it names the file by the path its
header shows and the blob on each side. The blobs are what keep it honest.
An amend or a rebase that leaves the file alone leaves both blobs alone, and
the file stays viewed. One that touches the file changes a blob, and the file
reads as not viewed until the reader looks again. A path alone would keep a
file marked viewed after it changed underneath the reader, which is the one
thing a viewed mark must not claim. The two blob ids are enough without
hashing the patch, because the patch is drawn from them. A mark that no longer
matches is left in place rather than pruned, as a stale comparison mark is:
nothing reads it, and a later rewrite that puts the old blobs back finds it.

Every comment names who wrote it. A comment written on this screen is the
reader's, and a comment kept before comments had authors reads as the
reader's too, since nothing else could have written it. The field is there
from the first comment so that once something other than the browser writes
comments, none of the earlier ones are left unattributed.

A change to the document is a `ReviewCommand`, a value that says what the
state should become: this comparison seen or not, this file viewed or not,
this comment added under the id its writer chose, resolved or not, or gone.
`applyCommand` turns a document and a command into the next document. None of
them says which way to flip anything, so a command applied twice leaves what
applying it once did, and whoever sends one can send it again after a failure
without asking whether the first attempt landed. A flip would undo itself on
the retry. Adding a comment under an id that is already there changes
nothing, for the same reason.

The screen still offers toggles, and the toggle is decided where the reader
clicked, from what the row reads at that moment. `markSeen` builds a command
that marks the row seen unless it reads reviewed, and `markViewed` one that
marks the file viewed unless it is. `commentOn` pins a new comment to the
commit it was read against, as described above.

All of this is the review [model](index.md#model): marks, comments, and
viewed files, each with the Zod schema that reads it back from storage; how
the stored document is read against the rows the interdiff returns; and the
commands that change it. The views name these shapes and call the readers,
and none of it needs React or storage, so it sits apart from the state that
holds the document.

```ts
//| id: frontend-model-review
//| file: src/frontend/model/review.ts
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
    /** Who wrote it. A comment kept before comments had authors was the
     *  reader's, since nothing else could write one. */
    author: z.string().default("reader"),
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

export const ReviewDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
  viewed: z.array(ViewedFile).default([]),
  reviewed: z.array(ReviewedVersion).default([]),
});
export type ReviewDocument = z.infer<typeof ReviewDocument>;

export const EMPTY_REVIEW: ReviewDocument = {
  marks: [],
  comments: [],
  viewed: [],
  reviewed: [],
};

export function isEmptyReview(document: ReviewDocument): boolean {
  return (
    document.marks.length === 0 &&
    document.comments.length === 0 &&
    document.viewed.length === 0 &&
    document.reviewed.length === 0
  );
}

/** The series a pull request's versions are marked reviewed under. */
export function pullSeries(repo: string, number: number): string {
  return `pull:${repo}#${number}`;
}

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
    kind: z.literal("resolve-comment"),
    id: z.string(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal("delete-comment"), id: z.string() }),
  z.object({
    kind: z.literal("mark-reviewed"),
    series: z.string(),
    version: z.string(),
    at: z.string(),
  }),
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
      };
  }
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
  markSeen: (row: ReviewedRow) => void;
  addComment: (row: ReviewedRow, anchor: Anchor, body: string) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
  toggleViewed: (row: ReviewedRow, file: FileVersion) => void;
  markReviewed: (series: string, version: string) => void;
}

/** The comparison a row stands for, as a mark names it. */
function comparisonOf(row: ReviewedRow): Comparison {
  return {
    reviewKey: row.reviewKey,
    fromCommitId: row.from?.commitId ?? null,
    toCommitId: row.to?.commitId ?? null,
  };
}

/** Marks the row seen, or unseen if it reads reviewed. */
export function markSeen(row: ReviewedRow, at: string): ReviewCommand {
  return {
    kind: "set-seen",
    comparison: comparisonOf(row),
    seen: row.review.state !== "reviewed",
    at,
  };
}

/** Marks one file of a row viewed, or not viewed if it is. */
export function markViewed(
  row: ReviewedRow,
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
  row: ReviewedRow,
  comment: Anchor & Pick<Comment, "id" | "body" | "createdAt" | "author">,
): ReviewCommand {
  const commit =
    comment.kind === "line" && comment.side === "before"
      ? (row.from ?? row.to)
      : (row.to ?? row.from);
  return {
    kind: "add-comment",
    comment: {
      ...comment,
      reviewKey: row.reviewKey,
      commitId: commit?.commitId ?? "",
      resolved: false,
    },
  };
}
```

The reorder case runs `alignSeries` for real rather than using a hand-rolled
fixture. The bug this schema guards against is in how `alignSeries`'s output
becomes review state, and a fixture written by hand could encode the same
wrong assumption the code is being tested against.

```ts
//| id: frontend-model-review-test
//| file: src/frontend/model/review.test.ts
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow, LogEntry } from "../api";
import {
  applyCommand,
  commentOn,
  EMPTY_REVIEW,
  type FileVersion,
  isViewed,
  markSeen,
  markViewed,
  type ReviewCommand,
  ReviewDocument,
  type ReviewedRow,
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
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "change:aaaa",
          fromCommitId: dropped.from?.commitId ?? null,
          toCommitId: dropped.to?.commitId ?? null,
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [],
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
        },
      ],
      viewed: [],
      reviewed: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("keeps a before-side comment fresh while its commit is the row's before side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: ReviewDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "line",
          path: "f.ts",
          side: "before",
          line: 3,
          commitId: "a1",
          body: "removed too soon",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
          author: "reader",
        },
      ],
      viewed: [],
      reviewed: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(false);
  });

  test("keeps a file comment fresh while its commit is the row's after side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: ReviewDocument = {
      marks: [],
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
        },
      ],
      viewed: [],
      reviewed: [],
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
      marks: [],
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
        },
      ],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [],
      reviewed: [],
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

  test("reads file and comparison comments back as themselves", () => {
    // arrange
    const written = {
      reviewKey: "change:a",
      commitId: "a2",
      body: "",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
      author: "agent",
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

  test("pins a comment to the commit on the side it was left on", () => {
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
    expect(document.comments.map((comment) => comment.commitId)).toEqual([
      "a1",
      "a2",
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
      { kind: "resolve-comment", id: "c1", resolved: true },
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
```

A comment or a comparison row is always in one of the same three states —
still open, resolved, or stale against a rewrite since it was written — and
`--review-open`, `--review-resolved`, and `--review-stale` are the one set
of roles that both the tone chip on a comparison header and the accent on a
comment thread read from. A resolved comment and a resolved row share a
colour without either file naming it.

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
    padding: var(--space-3) var(--space-4);
    margin: var(--space-2) var(--space-4);
    border-left: var(--border-width-accent) solid var(--review-open);
  }

  .comment-thread--resolved {
    border-left-color: var(--review-resolved);
    opacity: 0.72;
  }

  .comment-thread__meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--text-faint);
  }

  .comment-thread__stale {
    color: var(--review-stale);
  }
}
```
## Storage

The review document lives on the server, in the
[review store](../backend/review-store.md), so a second browser, a second tab,
and an agent all read and write the one the reader does. It used to live in
the browser's `localStorage`, which made a read synchronous and a write
unable to fail. Both come back with the server: the document arrives some
time after the screen does, and a write can be refused or never answered.

### Reading it from the server

`reviewStore` is the review document's repository, the same role
`localRepository` plays for [settings](settings.md), with the server behind
it instead of `localStorage`. It loads the document with its revision and
sends one command, answering with the document and revision the command
left. A refusal comes back as an `Error` carrying the server's own message.

It sits in `persistence/` rather than beside the other endpoints in
[`api.ts`](transport.md). `api.ts` reads what the repository and GitHub
say, and nothing it reads is the app's to change. `persistence/` is where
the app keeps its own documents, and which store keeps one is that layer's
decision, so moving the review document to the server changed that layer and
left `state/review.ts` talking to a repository as before.

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

`useReview` loads the document once, when the app starts, and holds it for
every screen. Until it arrives the handle is `loading` and the document is
empty, so a diff draws without review state rather than waiting for it,
since the diff is what the reader came for. A document the server cannot
read makes the handle `unavailable`, and the diff draws the same way. Only a
`ready` handle has `actions`, so a screen that draws the diff while nothing
has loaded has nothing to offer the reader that would write, and the type
says so rather than a flag each view has to remember to check.

A change shows at once. Each command the reader makes is applied to what
the screen shows before the server answers, and kept in a list of commands
in flight. The document on screen is the last one the server answered with,
with every command still in flight applied on top, through the same
`applyCommand` the server runs. An answer replaces the server's document and
takes its command off the list, and the answer already holds that command's
effect, so nothing on screen moves. A refused or unanswered command is taken
off the list too, which puts back what the server holds, and the reason is
kept in `failure` for the screen to say.

Holding the server's document apart from the commands in flight is what makes
a failure safe to undo. Undoing a failed change by restoring the document
from before it would also undo any change made since that did land.

Another writer's change arrives as a revision announced over
[a WebSocket](../backend/review-store.md#telling-screens-about-changes), and a
revision newer than the one held reads the document again. The socket also
counts as news each time it opens, since a write may have landed while it was
closed, and it reconnects after it drops, so a restarted server finds the
screen again. A read that fails leaves the document as it was, and the next
announcement tries again. Commands in flight stay applied on top of the new
document the way they sat on the old one.

Two answers can arrive in the order opposite to the one the server wrote
them in, and taking the second as it came would show the first command
undone until the next write. An answer replaces the document only when its
revision is higher than the one held.

```tsx
//| id: frontend-state-review
//| file: src/frontend/state/review.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AsyncState } from "../model/asyncState";
import {
  applyCommand,
  commentOn,
  EMPTY_REVIEW,
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
    return {
      markSeen: (row) => send(markSeen(row, now())),
      addComment: (row, anchor, body) =>
        send(
          commentOn(row, {
            id: crypto.randomUUID(),
            ...anchor,
            body,
            createdAt: now(),
            author: "reader",
          }),
        ),
      resolveComment: (id, resolved) =>
        send({ kind: "resolve-comment", id, resolved }),
      dropComment: (id) => send({ kind: "delete-comment", id }),
      toggleViewed: (row, file) => send(markViewed(row, file, now())),
      markReviewed: (series, version) =>
        send({ kind: "mark-reviewed", series, version, at: now() }),
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

The strip under the mode tabs says when review state is missing or a change
was lost, and says nothing otherwise. A lost change stays on the strip until
the reader dismisses it, since it has already disappeared from the screen
and the strip is the only place left that says it happened.

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

A reader who marked and commented before the server kept review state still
has all of it in `localStorage`, under `diffy.session.v1` and one
`diffy.last-reviewed.v1:` key per pull request. `legacyReview` reads all of
it into one document, and `useReview` sends that to the server as an
`import` command whenever the keys hold anything, then clears them.

An import adds what the server's document lacks and keeps what it has, so
sending one twice changes nothing, and one from a second browser, or from a
workspace served on another port with a `localStorage` of its own, adds that
browser's marks beside the first one's. Importing only into an empty
document was the other rule, and it would drop everything but the first
browser's for good. A clear that fails leaves the keys to be imported again,
which is the same harmless repeat.

A pull request's last reviewed head becomes a version
[marked reviewed](pull-requests.md#the-head-last-reviewed). The browser never
kept when it was marked, so it is dated at the import.

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
      marks: [mark],
      comments: [],
      viewed: [],
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
      { ...comment, kind: "line", side: "after", author: "reader" },
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
