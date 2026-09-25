// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-split-test>>[init]
import { describe, expect, test } from "bun:test";
import { splitRows } from "./split";

const context = { kind: "context", code: "keep" };
const hunk = { kind: "hunk", text: "@@ -1,4 +1,3 @@" };
const note = { kind: "meta", text: "\\ No newline at end of file" };

function removed(code: string) {
  return { kind: "removed", code };
}

function added(code: string) {
  return { kind: "added", code };
}

describe("splitRows", () => {
  test("puts a context line in both columns", () => {
    expect(splitRows([context])).toEqual([
      { kind: "pair", before: context, after: context },
    ]);
  });

  test("pairs a removed run with the added run after it, row by row", () => {
    // arrange
    const lines = [removed("a"), removed("b"), added("A"), added("B")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: added("A") },
      { kind: "pair", before: removed("b"), after: added("B") },
    ]);
  });

  test("leaves the longer run's extra lines beside an empty cell", () => {
    // arrange
    const lines = [removed("a"), added("A"), added("B"), added("C")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: added("A") },
      { kind: "pair", before: null, after: added("B") },
      { kind: "pair", before: null, after: added("C") },
    ]);
  });

  test("draws a lone removal or addition on its own side", () => {
    // arrange
    const lines = [removed("a"), context, added("b")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: null },
      { kind: "pair", before: context, after: context },
      { kind: "pair", before: null, after: added("b") },
    ]);
  });

  test("spans anything else across both columns, ending a run", () => {
    // arrange
    const lines = [hunk, removed("a"), note, added("a")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "across", line: hunk },
      { kind: "pair", before: removed("a"), after: null },
      { kind: "across", line: note },
      { kind: "pair", before: null, after: added("a") },
    ]);
  });
});
// ~/~ end
