// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-model-patch-test>>[init]
import { describe, expect, test } from "bun:test";
import { followLine, gapsOf, readPatch } from "./patch";

describe("readPatch", () => {
  test("numbers each line on the sides it is on", () => {
    // arrange
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "index 1111111..2222222 100644",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -10,3 +10,3 @@ function f() {",
      " keep",
      "-old",
      "+new",
      " keep",
      "",
    ].join("\n");

    // act
    const { header, hunks } = readPatch(patch);

    // assert
    expect(header).toHaveLength(4);
    expect(hunks).toEqual([
      {
        header: "@@ -10,3 +10,3 @@ function f() {",
        newStart: 10,
        oldStart: 10,
        lines: [
          { kind: "context", code: "keep", newLine: 10, oldLine: 10 },
          { kind: "removed", code: "old", oldLine: 11 },
          { kind: "added", code: "new", newLine: 11 },
          { kind: "context", code: "keep", newLine: 12, oldLine: 12 },
        ],
      },
    ]);
  });

  test("restarts the count at every hunk header", () => {
    // arrange
    const patch = ["@@ -1 +1 @@", "-a", "+b", "@@ -40,0 +41 @@", "+c"].join(
      "\n",
    );

    // act
    const { hunks } = readPatch(patch);

    // assert
    expect(hunks[1]?.lines).toEqual([
      { kind: "added", code: "c", newLine: 41 },
    ]);
  });

  test("gives a missing-newline note no line of its own", () => {
    // arrange
    const patch = [
      "@@ -1 +1 @@",
      "-a",
      "\\ No newline at end of file",
      "+a",
      " b",
    ].join("\n");

    // act
    const lines = readPatch(patch).hunks[0]?.lines;

    // assert
    expect(lines).toEqual([
      { kind: "removed", code: "a", oldLine: 1 },
      { kind: "note", text: "\\ No newline at end of file" },
      { kind: "added", code: "a", newLine: 1 },
      { kind: "context", code: "b", newLine: 2, oldLine: 2 },
    ]);
  });

  test("reads a patch with no hunks as all header", () => {
    // arrange
    const patch = "diff --git a/b.bin b/b.bin\nBinary files differ\n";

    // act
    const { header, hunks } = readPatch(patch);

    // assert
    expect(header).toEqual([
      "diff --git a/b.bin b/b.bin",
      "Binary files differ",
    ]);
    expect(hunks).toEqual([]);
  });
});

describe("followLine", () => {
  const patch = readPatch(
    [
      "@@ -2,0 +3,2 @@",
      "+one",
      "+two",
      "@@ -8,3 +10,2 @@",
      " keep",
      "-gone",
      " keep",
      "",
    ].join("\n"),
  );

  test("leaves a line above every hunk where it was", () => {
    expect(followLine(patch, 2)).toEqual({ side: "after", line: 2 });
  });

  test("shifts a line below an insertion by what it inserts", () => {
    expect(followLine(patch, 3)).toEqual({ side: "after", line: 5 });
  });

  test("reads a context line's new number off its hunk", () => {
    expect(followLine(patch, 10)).toEqual({ side: "after", line: 11 });
  });

  test("keeps a removed line on the before side", () => {
    expect(followLine(patch, 9)).toEqual({ side: "before", line: 9 });
  });

  test("shifts a line below every hunk by what all of them add and remove", () => {
    expect(followLine(patch, 20)).toEqual({ side: "after", line: 21 });
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-model-patch-test>>[1]

describe("gapsOf", () => {
  test("names the lines before, between, and after the hunks", () => {
    // arrange
    const patch = readPatch(
      [
        "@@ -4,2 +4,2 @@",
        " a",
        "-b",
        "+c",
        "@@ -20,1 +20,2 @@",
        " d",
        "+e",
      ].join("\n"),
    );

    // act
    const gaps = gapsOf(patch, 30);

    // assert
    expect(gaps).toEqual([
      { start: 1, count: 3, oldStart: 1 },
      { start: 6, count: 14, oldStart: 6 },
      { start: 22, count: 9, oldStart: 21 },
    ]);
  });

  test("resumes after a hunk that only removes", () => {
    // arrange
    const patch = readPatch(["@@ -5,2 +4,0 @@", "-a", "-b"].join("\n"));

    // act
    const gaps = gapsOf(patch, 10);

    // assert
    expect(gaps).toEqual([
      { start: 1, count: 4, oldStart: 1 },
      { start: 5, count: 6, oldStart: 7 },
    ]);
  });

  test("finds nothing hidden in a file the hunk covers whole", () => {
    // arrange
    const patch = readPatch(["@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"));

    // act
    // assert
    expect(gapsOf(patch, 2).map((gap) => gap.count)).toEqual([0, 0]);
  });
});
// ~/~ end
