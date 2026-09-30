// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack-test>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import { countLines } from "./CommitStack";

describe("countLines", () => {
  test("ignores the +++/--- file header lines", () => {
    // arrange
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "--- a/a.ts\n+++ b/a.ts\n+added line\n-removed line\n context",
        structural: { kind: "unavailable", reason: "not diffed" },
      },
    ];

    // act
    const { added, removed } = countLines(files);

    // assert
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });
});
// ~/~ end
