// ~/~ begin <<docs/architecture/backend/runs.md#backend-evidence-play-run-test>>[init]
import { describe, expect, test } from "bun:test";
import { lineRuns } from "../../frontend/model/runs";
import { labelOf, linesRun } from "./playRun";

describe("the lines a step ran", () => {
  test("the innermost range decides, and blank characters do not count", () => {
    // arrange
    const text = "function f() {\n  if (x) {\n    y();\n  }\n}\nf();\n";

    // act
    const lines = linesRun(text, [
      { startOffset: 0, endOffset: text.length, count: 1 },
      { startOffset: 24, endOffset: 39, count: 0 },
    ]);

    // assert
    expect(lines).toEqual([1, 2, 5, 6]);
  });

  test("an inline script's lines start where it does in its page", () => {
    // act
    const lines = linesRun(
      "a();\n",
      [{ startOffset: 0, endOffset: 4, count: 1 }],
      9,
    );

    // assert
    expect(lines).toEqual([10]);
  });

  test("line numbers fold into runs", () => {
    // act
    const runs = lineRuns([5, 1, 2, 3, 9, 2]);

    // assert
    expect(runs).toEqual([
      [1, 3],
      [5, 5],
      [9, 9],
    ]);
  });

  test("a step is labelled by what it does unless named", () => {
    // act
    const labels = [
      labelOf({ do: "click", selector: "#dark" }),
      labelOf({ do: "press", key: "Enter", label: "Submit" }),
    ];

    // assert
    expect(labels).toEqual(["click #dark", "Submit"]);
  });
});
// ~/~ end
