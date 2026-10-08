// ~/~ begin <<docs/architecture/frontend/review.md#frontend-model-review-test>>[init]
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

  test("reopens a resolved thread when it gets a reply", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const resolved = applied(
      empty,
      commentOn(row, {
        id: "c1",
        kind: "comparison",
        body: "why?",
        createdAt: "t1",
        author: "reader",
      }),
      { kind: "resolve-comment", id: "c1", resolved: true },
    );

    // act
    const answered = applied(resolved, {
      kind: "add-reply",
      commentId: "c1",
      reply: { id: "r1", body: "not yet", createdAt: "t2", author: "reader" },
    });

    // assert
    expect(answered.comments[0]?.resolved).toBe(false);
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
// ~/~ end
