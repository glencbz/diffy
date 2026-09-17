// ~/~ begin <<docs/architecture/backend/series.md#series-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { alignSeries, type SeriesCommit } from "./series";

/** `"a b c"` -> that series, newest first, each commit its own version. */
function series(changes: string, version = "1"): SeriesCommit[] {
  return changes
    .split(" ")
    .reverse()
    .map((changeId) => ({ changeId, commitId: `${changeId}${version}` }));
}

/** Render rows as `"before>after"` per pair, with `-` for a missing side. */
function shape(rows: { from: SeriesCommit | null; to: SeriesCommit | null }[]) {
  return rows
    .map((row) => `${row.from?.changeId ?? "-"}>${row.to?.changeId ?? "-"}`)
    .join(" ");
}

/** `"a b c"` -> that series, newest first, no change ids: a git series. */
function noIdSeries(commitIds: string): SeriesCommit[] {
  return commitIds
    .split(" ")
    .reverse()
    .map((commitId) => ({ changeId: null, commitId }));
}

/** `shape`, keyed on commit id, for rows whose change id is always null. */
function shapeByCommit(
  rows: { from: SeriesCommit | null; to: SeriesCommit | null }[],
) {
  return rows
    .map((row) => `${row.from?.commitId ?? "-"}>${row.to?.commitId ?? "-"}`)
    .join(" ");
}

describe("alignSeries", () => {
  test("pairs an unchanged series commit for commit", () => {
    // arrange
    // act
    const rows = alignSeries(series("a b c"), series("a b c", "2"));

    // assert
    expect(shape(rows)).toBe("c>c b>b a>a");
  });

  test("keeps both sides of a pair", () => {
    // arrange
    // act
    const [row] = alignSeries(series("a"), series("a", "2"));

    // assert
    expect(row?.from?.commitId).toBe("a1");
    expect(row?.to?.commitId).toBe("a2");
  });

  test("reports a commit dropped from the middle", () => {
    // arrange
    // act
    const rows = alignSeries(series("a b c"), series("a c", "2"));

    // assert
    expect(shape(rows)).toBe("c>c b>- a>a");
  });

  test("reports a commit inserted into the middle", () => {
    // arrange
    // act
    const rows = alignSeries(series("a c"), series("a b c", "2"));

    // assert
    expect(shape(rows)).toBe("c>c ->b a>a");
  });

  test("reports commits appended to the newer series", () => {
    // arrange
    // act
    const rows = alignSeries(series("a"), series("a b", "2"));

    // assert
    expect(shape(rows)).toBe("->b a>a");
  });

  test("pairs by position when no change id survives", () => {
    // arrange
    // act
    const rows = alignSeries(series("a b"), series("x y", "2"));

    // assert
    expect(shape(rows)).toBe("b>y a>x");
  });

  test("lines up a reordered series without losing a commit", () => {
    // arrange
    // act
    const rows = alignSeries(series("a b c"), series("a c b", "2"));

    // assert
    const paired = rows.filter((row) => row.from && row.to).length;
    expect(rows).toHaveLength(4);
    expect(paired).toBe(2);
  });

  test("handles an empty side", () => {
    // arrange
    // act
    // assert
    expect(shape(alignSeries([], series("a b")))).toBe("->b ->a");
    expect(shape(alignSeries(series("a b"), []))).toBe("b>- a>-");
    expect(alignSeries([], [])).toEqual([]);
  });

  test("pairs positionally when no commit carries a change id", () => {
    // arrange
    // act
    const rows = alignSeries(
      noIdSeries("first second"),
      noIdSeries("first2 second2"),
    );

    // assert
    expect(shapeByCommit(rows)).toBe("second>second2 first>first2");
  });

  test("mis-pairs when a series without change ids gains a commit at its oldest end", () => {
    // arrange
    // act
    const rows = alignSeries(
      noIdSeries("first second"),
      noIdSeries("zero2 first2 second2"),
    );

    // assert
    // Pinned, not wanted. `zero2` should read as an insert on its own row.
    // If this fails, alignSeries learned to align change-id-less commits;
    // update the test and the prose at the top of this doc.
    expect(shapeByCommit(rows)).toBe("->second2 second>first2 first>zero2");
  });
});
// ~/~ end
