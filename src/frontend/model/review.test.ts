// ~/~ begin <<docs/architecture/frontend/review.md#frontend-model-review-test>>[init]
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow, LogEntry } from "../api";
import {
  addComment,
  dropComment,
  type FileVersion,
  flipSeen,
  flipViewed,
  isViewed,
  ReviewDocument,
  resolveComment,
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
    const document: ReviewDocument = { marks: [], comments: [], viewed: [] };

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
    const changeARows = reviewRows(rows, {
      marks: [],
      comments: [],
      viewed: [],
    }).filter((row) => row.reviewKey === "change:aaaa");
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
        },
      ],
      viewed: [],
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
        },
      ],
      viewed: [],
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
        },
      ],
      viewed: [],
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
        },
      ],
      viewed: [],
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

  test("reads file and comparison comments back as themselves", () => {
    // arrange
    const written = {
      reviewKey: "change:a",
      commitId: "a2",
      body: "",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
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

describe("viewed files", () => {
  const empty: ReviewDocument = { marks: [], comments: [], viewed: [] };
  const file: FileVersion = { path: "f.ts", oldBlob: "b1", newBlob: "b2" };

  test("reads a file viewed on its row once it is marked", () => {
    // arrange
    const document = flipViewed(
      empty,
      "change:a",
      file,
      "2026-09-25T09:00:00Z",
    );

    // act
    const [row] = reviewRows([pairRow("a", "a1", "a2")], document);

    // assert
    expect(isViewed(row?.viewed ?? [], file)).toBe(true);
  });

  test("unmarks a file marked a second time", () => {
    // arrange
    const marked = flipViewed(empty, "change:a", file, "2026-09-25T09:00:00Z");

    // act
    const unmarked = flipViewed(
      marked,
      "change:a",
      file,
      "2026-09-25T09:01:00Z",
    );

    // assert
    expect(unmarked.viewed).toEqual([]);
  });

  test("reads a file not viewed once its after side has changed", () => {
    // arrange
    const document = flipViewed(
      empty,
      "change:a",
      file,
      "2026-09-25T09:00:00Z",
    );

    // act
    const [row] = reviewRows([pairRow("a", "a1", "a3")], document);

    // assert
    expect(isViewed(row?.viewed ?? [], { ...file, newBlob: "b3" })).toBe(false);
  });

  test("keeps a viewed mark to the row it was made on", () => {
    // arrange
    const document = flipViewed(
      empty,
      "change:a",
      file,
      "2026-09-25T09:00:00Z",
    );

    // act
    const [row] = reviewRows([pairRow("b", "b1", "b2")], document);

    // assert
    expect(isViewed(row?.viewed ?? [], file)).toBe(false);
  });
});

describe("changes to the document", () => {
  const empty: ReviewDocument = { marks: [], comments: [], viewed: [] };

  function reviewedRow(row: InterdiffRow, document: ReviewDocument) {
    const [reviewed] = reviewRows([row], document);
    if (reviewed === undefined) throw new Error("no row");
    return reviewed;
  }

  test("marks a row seen, and reads it reviewed", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");

    // act
    const document = flipSeen(
      empty,
      reviewedRow(row, empty),
      "2026-09-25T09:00:00Z",
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
    const marked = flipSeen(
      empty,
      reviewedRow(row, empty),
      "2026-09-25T09:00:00Z",
    );

    // act
    const document = flipSeen(
      marked,
      reviewedRow(row, marked),
      "2026-09-25T09:01:00Z",
    );

    // assert
    expect(document.marks).toEqual([]);
  });

  test("keeps the old mark when a changed row is marked again", () => {
    // arrange
    const marked = flipSeen(
      empty,
      reviewedRow(pairRow("a", "a1", "a2"), empty),
      "2026-09-25T09:00:00Z",
    );
    const amended = pairRow("a", "a1", "a3");

    // act
    const document = flipSeen(
      marked,
      reviewedRow(amended, marked),
      "2026-09-25T09:01:00Z",
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
    } as const;

    // act
    const document = addComment(
      addComment(empty, row, { ...at, id: "c1", side: "before" }),
      row,
      { ...at, id: "c2", side: "after" },
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
    const document = addComment(empty, row, {
      id: "c1",
      kind: "line",
      path: "f.ts",
      side: "before",
      line: 3,
      body: "hm",
      createdAt: "t",
    });

    // assert
    expect(document.comments[0]?.commitId).toBe("a2");
  });

  test("pins a file or comparison comment to the row's after side", () => {
    // arrange
    const row = reviewedRow(pairRow("a", "a1", "a2"), empty);
    const at = { body: "hm", createdAt: "t" };

    // act
    const document = addComment(
      addComment(empty, row, { ...at, id: "c1", kind: "file", path: "f.ts" }),
      row,
      { ...at, id: "c2", kind: "comparison" },
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
    } as const;
    const two = addComment(
      addComment(empty, row, { ...at, id: "c1", createdAt: "t1" }),
      row,
      { ...at, id: "c2", createdAt: "t2" },
    );

    // act
    const resolved = resolveComment(two, "c1", true);
    const dropped = dropComment(resolved, "c1");

    // assert
    expect(resolved.comments.map((comment) => comment.resolved)).toEqual([
      true,
      false,
    ]);
    expect(dropped.comments.map((comment) => comment.id)).toEqual(["c2"]);
  });
});
// ~/~ end
