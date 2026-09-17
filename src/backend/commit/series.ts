// ~/~ begin <<docs/architecture/backend/series.md#series-module>>[init]

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
// ~/~ end
