// ~/~ begin <<docs/architecture/frontend/combined-graph.md#frontend-model-combined-log-test>>[init]
import { describe, expect, test } from "bun:test";
import { combineLogs, layoutEntries, tick } from "./combinedLog";
import type { LogEntry } from "./history";

function entry(
  commitId: string,
  changeId: string | null,
  parents: string[] = [],
): LogEntry {
  return {
    commitId,
    changeId,
    description: commitId,
    parents,
    author: "someone@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    refs: [],
    markers: [],
  };
}

describe("combineLogs", () => {
  test("names how each change moved between the operations", () => {
    // arrange
    const before = [
      entry("c2", "kept", ["c1"]),
      entry("d1", "dropped", ["c1"]),
      entry("c1", "base"),
    ];
    const after = [
      entry("n1", "added", ["c3"]),
      entry("c3", "kept", ["c1"]),
      entry("c1", "base"),
    ];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["added", "new"],
      ["kept", "rewritten"],
      ["dropped", "gone"],
      ["base", "same"],
    ]);
    expect(rows[1]?.before?.commitId).toBe("c2");
    expect(rows[1]?.after?.commitId).toBe("c3");
  });

  test("puts a gone row ahead of the next before row the after log keeps", () => {
    // arrange
    const before = [
      entry("g1", "gone-top", ["k2"]),
      entry("k2", "kept-2", ["g2"]),
      entry("g2", "gone-mid", ["k1"]),
      entry("k1", "kept-1"),
    ];
    const after = [entry("k2", "kept-2", ["k1"]), entry("k1", "kept-1")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => row.key)).toEqual([
      "gone-top",
      "kept-2",
      "gone-mid",
      "kept-1",
    ]);
  });

  test("keeps a gone row the after log has nothing below at the end", () => {
    // act
    const rows = combineLogs(
      [entry("a", "a"), entry("old", "old")],
      [entry("a", "a")],
    );

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["a", "same"],
      ["old", "gone"],
    ]);
  });

  test("keys a divergent change by commit id on both sides", () => {
    // arrange
    const before = [entry("x1", "twin")];
    const after = [entry("x1", "twin"), entry("x2", "twin")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["x1", "same"],
      ["x2", "new"],
    ]);
  });

  test("keys an entry with no change id by commit id", () => {
    // act
    const rows = combineLogs([entry("g1", null)], [entry("g2", null)]);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["g2", "new"],
      ["g1", "gone"],
    ]);
  });

  test("draws a row's parents from the after entry, as row keys", () => {
    // arrange
    const before = [entry("c2", "child", ["p1"]), entry("p1", "parent")];
    const after = [entry("c3", "child", ["p2"]), entry("p2", "parent")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows[0]?.parents).toEqual(["parent"]);
  });

  test("draws a gone row's parents from the before entry", () => {
    // arrange
    const before = [entry("g", "gone", ["b1"]), entry("b1", "base")];
    const after = [entry("b2", "base")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows[0]).toMatchObject({ key: "gone", parents: ["base"] });
  });
});

describe("layoutEntries", () => {
  test("links the rows by key, labelled as the row is", () => {
    // arrange
    const rows = combineLogs(
      [entry("g", "gone", ["b1"]), entry("b1", "base")],
      [entry("b2", "base")],
    );

    // act
    const entries = layoutEntries(rows);

    // assert
    expect(entries.map((e) => [e.commitId, e.parents, e.description])).toEqual([
      ["gone", ["base"], "g"],
      ["base", [], "b2"],
    ]);
  });
});

describe("tick", () => {
  const log = [entry("c", "c"), entry("b", "b"), entry("a", "a")];

  test("adds a commit in log order, not click order", () => {
    expect(tick(log, ["a"], "c")).toEqual(["c", "a"]);
  });

  test("removes a ticked commit", () => {
    expect(tick(log, ["c", "a"], "a")).toEqual(["c"]);
  });
});
// ~/~ end
