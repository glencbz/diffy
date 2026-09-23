// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-review-test>>[init]
import { describe, expect, test } from "bun:test";
import { type FileDiff, type GitCommit, GitOid } from "../api";
import type { AsyncState } from "../state/asyncState";
import type { Slot } from "../state/pairing";
import { baseStackRows, stackRows } from "./PullReview";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function commit(ch: string, description: string): GitCommit {
  return {
    commitId: oid(ch),
    parents: [],
    description,
    author: "someone@example.com",
    authoredAt: "2026-01-01T00:00:00Z",
    changeId: null,
  };
}

describe("stackRows", () => {
  test("gives an added row to a slot with nothing on the old side", () => {
    // arrange
    const added = commit("b", "add a thing");
    const slots: Slot[] = [{ left: null, right: added.commitId }];
    const diffs = new Map<string, AsyncState<FileDiff[]>>();

    // act
    const rows = stackRows(slots, [], [added], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `:${added.commitId}`,
        kind: "added",
        commit: added,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });

  test("gives a dropped row to a slot with nothing on the new side", () => {
    // arrange
    const dropped = commit("a", "remove a thing");
    const slots: Slot[] = [{ left: dropped.commitId, right: null }];
    const diffs = new Map<string, AsyncState<FileDiff[]>>();

    // act
    const rows = stackRows(slots, [dropped], [], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `${dropped.commitId}:`,
        kind: "dropped",
        commit: dropped,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });

  test("reads a paired slot as amended when the comparison finds a diff", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        patch: "@@ -1 +1 @@\n-a\n+b",
      },
    ];
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: files }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows).toEqual([
      {
        key,
        kind: "amended",
        commit: now,
        was,
        files: { status: "ready", data: files },
      },
    ]);
  });

  test("reads a paired slot as unchanged when the comparison is empty", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: [] }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("unchanged");
  });

  test("reads a paired slot as reworded when only the message moved", () => {
    // arrange
    const was = commit("a", "old subject");
    const now = commit("b", "new subject");
    const key = `${was.commitId}:${now.commitId}`;
    const message: FileDiff = {
      status: "modified",
      path: "JJ-COMMIT-DESCRIPTION",
      binary: false,
      patch: "@@ -1 +1 @@\n-old subject\n+new subject",
    };
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: [message] }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("reworded");
  });

  test("reads a paired slot as amended when the message and the code both moved", () => {
    // arrange
    const was = commit("a", "old subject");
    const now = commit("b", "new subject");
    const key = `${was.commitId}:${now.commitId}`;
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "JJ-COMMIT-DESCRIPTION",
        binary: false,
        patch: "@@ -1 +1 @@\n-old subject\n+new subject",
      },
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        patch: "@@ -1 +1 @@\n-a\n+b",
      },
    ];
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: files }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("amended");
  });

  test("reads a paired slot as plain while its comparison is still loading", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "loading" }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("plain");
  });
});

describe("baseStackRows", () => {
  test("gives one plain row per commit, keyed the way a slot with no old side is", () => {
    // arrange
    const one = commit("a", "first");
    const two = commit("b", "second");
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [`:${one.commitId}`, { status: "ready", data: [] }],
    ]);

    // act
    const rows = baseStackRows([one, two], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `:${one.commitId}`,
        kind: "plain",
        commit: one,
        was: null,
        files: { status: "ready", data: [] },
      },
      {
        key: `:${two.commitId}`,
        kind: "plain",
        commit: two,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });
});
// ~/~ end
