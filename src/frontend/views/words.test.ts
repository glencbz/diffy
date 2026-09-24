// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-words-test>>[init]
import { describe, expect, test } from "bun:test";
import type { HunkLine } from "./patch";
import { changedLines, changedWords, paintWords } from "./words";

describe("changedWords", () => {
  test("marks the words an edit changed on each side", () => {
    // arrange
    // act
    const ranges = changedWords(
      "return { status, path, patch };",
      "return { status, path, oldBlob, patch };",
    );

    // assert
    expect(ranges).toEqual({ old: [], new: [{ start: 23, end: 32 }] });
  });

  test("marks a renamed word whole rather than letter by letter", () => {
    // arrange
    // act
    const ranges = changedWords("const oldPath = 1;", "const newPath = 1;");

    // assert
    expect(ranges).toEqual({
      old: [{ start: 6, end: 13 }],
      new: [{ start: 6, end: 13 }],
    });
  });

  test("marks nothing in a pair that was rewritten", () => {
    // arrange
    // act
    // assert
    expect(changedWords("import a from 'b';", "}")).toBeNull();
  });
});

describe("changedLines", () => {
  test("pairs removed lines with the added run after them, in order", () => {
    // arrange
    const lines: HunkLine[] = [
      { kind: "context", code: "keep", newLine: 1 },
      { kind: "removed", code: "let a = 1;", oldLine: 2 },
      { kind: "removed", code: "let b = 2;", oldLine: 3 },
      { kind: "added", code: "let a = 10;", newLine: 2 },
      { kind: "added", code: "extra line", newLine: 3 },
      { kind: "added", code: "one more", newLine: 4 },
    ];

    // act
    const ranges = changedLines(lines);

    // assert: `let b` against `extra line` is a rewrite, and `one more`
    // has no removed line to be compared with.
    expect([...ranges.keys()].sort()).toEqual([1, 3]);
    expect(ranges.get(1)).toEqual([{ start: 8, end: 9 }]);
    expect(ranges.get(3)).toEqual([{ start: 8, end: 10 }]);
  });

  test("pairs nothing across a context line", () => {
    // arrange
    const lines: HunkLine[] = [
      { kind: "removed", code: "let a = 1;", oldLine: 1 },
      { kind: "context", code: "keep", newLine: 1 },
      { kind: "added", code: "let a = 2;", newLine: 2 },
    ];

    // act
    // assert
    expect(changedLines(lines).size).toBe(0);
  });
});

describe("paintWords", () => {
  test("cuts tokens at the edges of a changed range", () => {
    // arrange
    const tokens = [
      { text: "const", kind: "keyword" as const },
      { text: " newPath = 1;", kind: null },
    ];

    // act
    const painted = paintWords(tokens, [{ start: 6, end: 13 }]);

    // assert
    expect(painted).toEqual([
      { text: "const", kind: "keyword", changed: false },
      { text: " ", kind: null, changed: false },
      { text: "newPath", kind: null, changed: true },
      { text: " = 1;", kind: null, changed: false },
    ]);
  });
});
// ~/~ end
