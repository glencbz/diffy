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
});
// ~/~ end
