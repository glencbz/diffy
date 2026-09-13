# Lining up two commit series

Comparing one commit against another answers "how did this change change?".
Comparing a whole branch against its earlier self is the question people
actually have, and it needs an extra step first: deciding which commit on the
before side belongs opposite which commit on the after side.

Positional pairing, first against first, is wrong the moment a commit is
inserted or dropped. Everything after the gap shifts by one and every row
below it becomes a comparison between two unrelated changes, which is worse
than showing nothing.

jj already keeps the identity we need. A change id survives an amend, a
reword, and a rebase, so the same change id on both sides means the same
logical commit at two points in its life. `alignSeries` walks both series
oldest first and pairs on change id, and falls back to position only where
change ids give no answer at all. Its three outcomes:

* both sides present: the commit exists in both series, so the row is an
  interdiff.
* after side only: the commit was added to the series.
* before side only: the commit was dropped from it.

Ordering is the caller's convention, kept intact: both arguments arrive in
`jj log` order, newest first, and the rows come back in that order too, so
the panel reads top to bottom alongside the graphs that fed it.

The function is generic over the commit type and asks only for `commitId` and
`changeId`. It is the one piece of this feature with no jj in it, and the tech
plan wants a GitHub backend later, whose commits will need lining up the same
way.

```ts
//| id: series-module
//| file: src/backend/commit/series.ts

/** The identity a commit needs to be lined up against another. */
export interface SeriesCommit {
  commitId: string;
  changeId: string;
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

    if (left.changeId === right.changeId) {
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

/** Distance from `start` to the next commit with `changeId`, or null. */
function indexOfChange(
  commits: SeriesCommit[],
  start: number,
  changeId: string,
): number | null {
  for (let at = start; at < commits.length; at += 1) {
    if (commits[at]?.changeId === changeId) return at - start;
  }
  return null;
}
```

## Test

`alignSeries` is a pure function over two lists, so the tests are fixtures.
Each commit is written as a change id and a commit id, which is all the
function reads. The cases are the ones that made positional pairing untenable:
a commit dropped from the middle, one inserted, and the two sides reordered.

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
```
