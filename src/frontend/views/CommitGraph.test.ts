// ~/~ begin <<docs/architecture/frontend.md#frontend-view-commit-graph-test>>[init]
import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../api";
import { layoutGraph } from "./CommitGraph";

function commit(id: string, parents: string[]): LogEntry {
  return { commitId: id, changeId: `${id}-change`, description: id, parents };
}

describe("layoutGraph", () => {
  test("keeps a linear history in one lane", () => {
    const { rows, laneCount } = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.some((r) => r.isMerge)).toBe(false);
  });

  test("splits a fork and collapses the merge back to lane zero", () => {
    const { rows, laneCount } = layoutGraph([
      commit("m", ["l", "r"]),
      commit("l", ["base"]),
      commit("r", ["base"]),
      commit("base", []),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(rows.map((r) => r.isMerge)).toEqual([true, false, false, false]);
    // the merge node fans a second parent out into lane one...
    expect(rows[0]?.outgoing).toContainEqual({ from: 0, to: 1 });
    // ...and the right side branch routes back into lane zero.
    expect(rows[2]?.outgoing).toContainEqual({ from: 1, to: 0 });
  });
});
// ~/~ end
