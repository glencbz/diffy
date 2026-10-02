# Lining up two commit series

Comparing a branch against its earlier self first needs to decide which
before commit sits opposite which after commit. Positional pairing breaks on
the first insert or drop: every row below it compares two unrelated changes.
A jj change id survives amend, reword, and rebase, so `alignSeries` pairs on
it. A row with both sides is an interdiff; one side only is an add or a drop.

Git has no change id, so a git commit sends `changeId: null` rather than its
oid, which changes on every rewrite. Two nulls never match. A git series
therefore pairs by position, oldest against oldest, which breaks on a rebase
onto a new base; `series.test.ts` pins that wrong output under a name saying
so, so whoever gives git an identity (a `Change-Id` trailer, a patch id) sees
it fail first.

```ts
//| id: series-module
//| file: src/backend/commit/series.ts

/** The identity a commit needs to be lined up against another. A backend
 * with no change ids sends null, never a stand-in. */
export interface SeriesCommit {
  commitId: string;
  changeId: string | null;
}

/** One row of a lined-up comparison. At least one side is always present. */
export interface AlignedPair<T> {
  from: T | null;
  to: T | null;
}

/**
 * Pair up two versions of a commit series, newest first in and newest first
 * out. Commits sharing a change id are matched; the rest fall back to order.
 */
export function alignSeries<T extends SeriesCommit>(
  before: T[],
  after: T[],
): AlignedPair<T>[] {
  const olderFirstBefore = [...before].reverse();
  const olderFirstAfter = [...after].reverse();
  const rows: AlignedPair<T>[] = [];

  let i = 0;
  let j = 0;
  while (i < olderFirstBefore.length && j < olderFirstAfter.length) {
    const left = olderFirstBefore[i];
    const right = olderFirstAfter[j];
    if (left === undefined || right === undefined) break;

    if (left.changeId != null && left.changeId === right.changeId) {
      rows.push({ from: left, to: right });
      i += 1;
      j += 1;
      continue;
    }

    // How far ahead does each side's current commit turn up on the other?
    const leftAhead = indexOfChange(olderFirstAfter, j, left.changeId);
    const rightAhead = indexOfChange(olderFirstBefore, i, right.changeId);

    if (
      leftAhead !== null &&
      (rightAhead === null || leftAhead <= rightAhead)
    ) {
      // The after side reaches `left` later, so `right` is new before it.
      rows.push({ from: null, to: right });
      j += 1;
    } else if (rightAhead !== null) {
      rows.push({ from: left, to: null });
      i += 1;
    } else {
      // Neither change id survives on the other side: a rewrite, so pair them.
      rows.push({ from: left, to: right });
      i += 1;
      j += 1;
    }
  }

  // Whatever is left on either side had nothing to pair with.
  for (const commit of olderFirstBefore.slice(i)) {
    rows.push({ from: commit, to: null });
  }
  for (const commit of olderFirstAfter.slice(j)) {
    rows.push({ from: null, to: commit });
  }

  return rows.reverse();
}

/** Distance from `start` to the next commit with `changeId`, or null. A null
 * `changeId` matches nothing. */
function indexOfChange(
  commits: SeriesCommit[],
  start: number,
  changeId: string | null,
): number | null {
  if (changeId == null) return null;
  for (let at = start; at < commits.length; at += 1) {
    if (commits[at]?.changeId === changeId) return at - start;
  }
  return null;
}
```

## Test

```ts
//| id: series-module-test
//| file: src/backend/commit/series.test.ts
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
```
