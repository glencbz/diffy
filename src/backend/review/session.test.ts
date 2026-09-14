// ~/~ begin <<docs/architecture/backend/review.md#review-session-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEdit,
  readSession,
  type SessionComment,
  type SessionMark,
} from "./session";

const comment: SessionComment = {
  id: "c1",
  changeId: "a",
  path: "src/server.ts",
  line: 12,
  commitId: "a2",
  body: "this reads backwards",
  resolved: false,
  createdAt: "2026-09-14T09:00:00.000Z",
};

function seen(mark: Partial<SessionMark> = {}): SessionMark {
  return {
    changeId: "a",
    fromCommitId: "a1",
    toCommitId: "a2",
    seenAt: "2026-09-14T09:00:00.000Z",
    ...mark,
  };
}

beforeEach(() => {
  process.env.DIFFY_SESSION_DB = join(
    mkdtempSync(join(tmpdir(), "diffy-session-")),
    "session.sqlite",
  );
});

describe("readSession", () => {
  test("starts empty", () => {
    // arrange
    // act
    // assert
    expect(readSession()).toEqual({ marks: [], comments: [] });
  });
});

describe("applyEdit", () => {
  test("stores a mark", () => {
    // arrange
    // act
    applyEdit({ kind: "mark", ...seen() });

    // assert
    expect(readSession().marks).toEqual([seen()]);
  });

  test("stores a mark for a comparison with only one side", () => {
    // arrange
    const dropped = seen({ toCommitId: null });

    // act
    applyEdit({ kind: "mark", ...dropped });

    // assert
    expect(readSession().marks).toEqual([dropped]);
  });

  test("leaves one mark when the same comparison is marked twice", () => {
    // arrange
    applyEdit({ kind: "mark", ...seen() });

    // act
    applyEdit({
      kind: "mark",
      ...seen({ seenAt: "2026-09-15T09:00:00.000Z" }),
    });

    // assert
    expect(readSession().marks).toEqual([
      seen({ seenAt: "2026-09-15T09:00:00.000Z" }),
    ]);
  });

  test("keeps a mark per comparison when one change occupies two rows", () => {
    // arrange
    const dropped = seen({ toCommitId: null });
    const inserted = seen({ fromCommitId: null, toCommitId: "a2" });

    // act
    applyEdit({ kind: "mark", ...dropped });
    applyEdit({ kind: "mark", ...inserted });

    // assert
    expect(readSession().marks).toHaveLength(2);
  });

  test("unmarks only the comparison it names", () => {
    // arrange
    const dropped = seen({ toCommitId: null });
    applyEdit({ kind: "mark", ...seen() });
    applyEdit({ kind: "mark", ...dropped });

    // act
    applyEdit({
      kind: "unmark",
      changeId: dropped.changeId,
      fromCommitId: dropped.fromCommitId,
      toCommitId: dropped.toCommitId,
    });

    // assert
    expect(readSession().marks).toEqual([seen()]);
  });

  test("stores a comment", () => {
    // arrange
    // act
    applyEdit({ kind: "comment", comment });

    // assert
    expect(readSession().comments).toEqual([comment]);
  });

  test("resolves a comment", () => {
    // arrange
    applyEdit({ kind: "comment", comment });

    // act
    applyEdit({ kind: "resolveComment", id: comment.id, resolved: true });

    // assert
    expect(readSession().comments).toEqual([{ ...comment, resolved: true }]);
  });

  test("drops a comment", () => {
    // arrange
    applyEdit({ kind: "comment", comment });

    // act
    applyEdit({ kind: "dropComment", id: comment.id });

    // assert
    expect(readSession().comments).toEqual([]);
  });
});
// ~/~ end
