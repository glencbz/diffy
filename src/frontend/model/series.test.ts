// ~/~ begin <<docs/architecture/frontend/series.md#frontend-model-series-test>>[init]
import { describe, expect, test } from "bun:test";
import type { LocalReview } from "./review";
import { localHistory, rowAsk, versionAsk } from "./series";

const review: LocalReview = {
  name: "stack",
  versions: [
    {
      operation: "op1",
      revset: "trunk()..stack",
      commits: ["c1", "c2"],
      registeredAt: "2026-09-27T10:00:00Z",
    },
    {
      operation: "op2",
      revset: "trunk()..stack",
      commits: ["c3"],
      registeredAt: "2026-09-28T10:00:00Z",
    },
  ],
};

describe("localHistory", () => {
  test("numbers registrations from 1 and names them by number", () => {
    expect(localHistory(review).versions).toEqual([
      { id: "1", number: 1, label: "trunk()..stack, 2026-09-27" },
      { id: "2", number: 2, label: "trunk()..stack, 2026-09-28" },
    ]);
  });
});

describe("versionAsk", () => {
  test("asks for the commits a local version registered", () => {
    const source = { kind: "local", review } as const;

    expect(versionAsk(source, "2")).toEqual({ kind: "local", commits: ["c3"] });
    expect(() => versionAsk(source, "3")).toThrow("stack has no version 3");
    expect(rowAsk(source, { kind: "base" }, "2")).toEqual({ kind: "local" });
  });
});
// ~/~ end
