// ~/~ begin <<docs/architecture/frontend/review.md#frontend-model-review-test>>[init]
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow } from "./diff";
import type { LogEntry } from "./history";
import {
  applyCommand,
  commentOn,
  EMPTY_REVIEW,
  type FileVersion,
  isViewed,
  keepKey,
  keptPairing,
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
        },
      ],
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
      ...EMPTY_REVIEW,
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
    expect(next.comments[0]?.stale).toBe(false);
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
// ~/~ end
