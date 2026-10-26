// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-model-run-steps-test>>[init]
import { describe, expect, test } from "bun:test";
import { ranRules } from "./ranLines";
import type { Anchor, RowComment } from "./review";
import {
  compareLogged,
  compareRequests,
  isOnLogged,
  partAnchor,
  partNotes,
} from "./runSteps";
import type { Request } from "./runs";

const get = (
  url: string,
  status: number | null,
  body: string | null = null,
): Request => ({
  method: "GET",
  url,
  status,
  type: "fetch",
  body,
});

describe("comparing a step's sides", () => {
  test("marks requests new, gone, changed and the same", () => {
    // act
    const compared = compareRequests(
      [get("/a", 200), get("/b", 200), get("/c", 404)],
      [get("/a", 200), get("/c", 200), get("/d", 200)],
    );

    // assert
    expect(
      compared.map((each) => [each.change, (each.after ?? each.before)?.url]),
    ).toEqual([
      ["same", "/a"],
      ["changed", "/c"],
      ["new", "/d"],
      ["gone", "/b"],
    ]);
  });

  test("marks nothing when the parent never played", () => {
    // act
    const compared = compareLogged(null, [{ level: "log", text: "hi" }]);

    // assert
    expect(compared.map((each) => each.change)).toEqual(["same"]);
  });

  test("pairs a repeated line once each", () => {
    // act
    const compared = compareLogged(
      [{ level: "log", text: "tick" }],
      [
        { level: "log", text: "tick" },
        { level: "log", text: "tick" },
      ],
    );

    // assert
    expect(compared.map((each) => each.change)).toEqual(["same", "new"]);
  });
});

describe("marking the lines a step ran", () => {
  test("names each line of each run on its side, in the commit's row", () => {
    // act
    const rules = ranRules("c1", [{ path: "a.js", lines: [[2, 3]] }], null);

    // assert
    expect(rules).toContain(
      '.commit-stack__row[data-commit="c1"] .diff-file[data-path="a.js"] [data-anchor="after:2"]',
    );
    expect(rules).toContain('[data-anchor="after:3"]');
    expect(rules).not.toContain("before:");
  });

  test("marks nothing for a step that ran no lines", () => {
    // act
    const rules = ranRules("c1", [], []);

    // assert
    expect(rules).toBe("");
  });
});

describe("threads on a step's parts", () => {
  const comment = (id: string, anchor: Anchor): RowComment => ({
    id,
    reviewKey: "change:a",
    commitId: "c1",
    body: "",
    resolved: false,
    createdAt: "2026-10-26T00:00:00Z",
    author: "reader",
    replies: [],
    stale: false,
    numberedOn: null,
    ...anchor,
  });
  const warned = { level: "warn" as const, text: "slow theme" };
  const comments = [
    comment(
      "request",
      partAnchor("r", 1, {
        request: { method: "GET", url: "/a" },
        console: null,
      }),
    ),
    comment("line", partAnchor("r", 1, { request: null, console: warned })),
    comment("step", partAnchor("r", 1, { request: null, console: null })),
    comment("other", partAnchor("r", 0, { request: null, console: warned })),
  ];

  test("finds a step's request and console threads, not the step's own", () => {
    // act
    const found = partNotes(comments, "r", 1);

    // assert
    expect(found.map((each) => each.id)).toEqual(["request", "line"]);
  });

  test("puts a console thread on the line with its level and text", () => {
    // arrange
    const [, line] = comments as [RowComment, RowComment];

    // act
    const same = isOnLogged(line, { level: "warn", text: "slow theme" });
    const level = isOnLogged(line, { level: "error", text: "slow theme" });

    // assert
    expect([same, level]).toEqual([true, false]);
  });
});
// ~/~ end
