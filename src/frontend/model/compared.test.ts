// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-model-compared-test>>[init]
import { describe, expect, test } from "bun:test";
import { type CompareAsk, compareAsks, withCompared } from "./compared";
import type { FileDiff } from "./diff";
import { EMPTY_REVIEW, reviewComparison } from "./review";

const fields = {
  binary: false,
  patch: "",
  structural: { kind: "unavailable", reason: "test" },
} as const;

const deleted: FileDiff = {
  status: "deleted",
  path: "a.ts",
  oldBlob: "1",
  newBlob: null,
  ...fields,
};
const added: FileDiff = {
  status: "added",
  path: "b.ts",
  oldBlob: null,
  newBlob: "2",
  ...fields,
};
const pair: FileDiff = {
  status: "compared",
  oldPath: "a.ts",
  newPath: "b.ts",
  oldBlob: "1",
  newBlob: "2",
  ...fields,
};
const ask: CompareAsk = {
  fromCommit: null,
  toCommit: "c",
  oldPath: "a.ts",
  newPath: "b.ts",
};

describe("withCompared", () => {
  test("swaps a compared file for its pair once it arrives", () => {
    // arrange
    const lookup = () => ({ status: "ready", data: pair }) as const;

    // act
    const files = withCompared([deleted, added], [ask], lookup);

    // assert
    expect(files).toEqual([deleted, pair]);
  });

  test("keeps the file's own diff while the pair is on its way", () => {
    // arrange
    const lookup = () => ({ status: "loading" }) as const;

    // act
    const files = withCompared([deleted, added], [ask], lookup);

    // assert
    expect(files).toEqual([deleted, added]);
  });

  test("never swaps a deleted file, which has no after side", () => {
    // arrange
    const lookup = () => ({ status: "ready", data: pair }) as const;
    const onDeleted = { ...ask, newPath: "a.ts" };

    // act
    const files = withCompared([deleted], [onDeleted], lookup);

    // assert
    expect(files).toEqual([deleted]);
  });
});

describe("compareAsks", () => {
  test("asks nothing of a row with no after side", () => {
    // arrange
    const document = {
      ...EMPTY_REVIEW,
      compared: [{ reviewKey: "k", oldPath: "a.ts", newPath: "b.ts" }],
    };

    // act
    const asks = compareAsks(reviewComparison(document, "k", "x", null, null));

    // assert
    expect(asks).toEqual([]);
  });

  test("asks for each pair under the row's key, between its commits", () => {
    // arrange
    const document = {
      ...EMPTY_REVIEW,
      compared: [
        { reviewKey: "k", oldPath: "a.ts", newPath: "b.ts" },
        { reviewKey: "other", oldPath: "c.ts", newPath: "d.ts" },
      ],
    };

    // act
    const asks = compareAsks(reviewComparison(document, "k", "x", "y", null));

    // assert
    expect(asks).toEqual([
      { fromCommit: "x", toCommit: "y", oldPath: "a.ts", newPath: "b.ts" },
    ]);
  });
});
// ~/~ end
