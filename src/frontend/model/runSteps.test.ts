// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-model-run-steps-test>>[init]
import { describe, expect, test } from "bun:test";
import { compareLogged, compareRequests } from "./runSteps";
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
// ~/~ end
