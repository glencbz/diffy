# Commit history

The commit list a side is picked from, drawn as a graph, on both screens.

## Loading a side's commits

`commitsFrom` is the one place that dispatches on `source.kind`. A git commit
keeps `changeId: null` rather than its commit id: the two make different
promises, and `reviewKey` reads the null as its cue to key by revision.

```tsx
//| id: frontend-state-commits
//| file: src/frontend/state/commits.ts
import { useEffect, useState } from "react";
import { fetchLocalCommits, fetchLog, fetchPullCommits } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { GitCommit, LogEntry, Source } from "../model/history";

function asLogEntry(commit: GitCommit, changeId: string | null): LogEntry {
  return {
    commitId: commit.commitId,
    changeId,
    description: commit.description,
    parents: commit.parents,
    author: commit.author,
    timestamp: commit.authoredAt,
    refs: [],
    markers: [],
  };
}

/** The commits a source names. The one place a `Source` decides anything. */
export async function commitsFrom(source: Source): Promise<LogEntry[]> {
  if (source.kind === "jj") {
    return fetchLog(source.operation ?? undefined);
  }

  if (source.kind === "local") {
    const commits = await fetchLocalCommits(source.commits);
    return commits
      .map((commit) => asLogEntry(commit, commit.changeId))
      .reverse();
  }

  // A pull request commit's identity is a subject line, and `changeId` on a
  // LogEntry is what the graph prints as the commit's id, so it stays empty.
  // The pairing reads the identity off the GitCommit instead.
  const { commits } = await fetchPullCommits(
    source.repo,
    source.number,
    source.head,
  );
  return commits.map((commit) => asLogEntry(commit, null));
}

export function useCommits(source: Source): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });
  // A source is a fresh object every render; depend on its JSON and read the
  // source back out of it, so the dependency list cannot drift from the body.
  const key = JSON.stringify(source);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    commitsFrom(JSON.parse(key) as Source)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}
```

The test checks the URL asked for as well as the commits, since a source
reaching the wrong endpoint might still parse.

```ts
//| id: frontend-state-commits-test
//| file: src/frontend/state/commits.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { GitOid } from "../model/history";
import { commitsFrom } from "./commits";

const liveFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = liveFetch;
});

/** Answer every request with one canned body, recording what was asked for. */
function serve(body: unknown): string[] {
  const asked: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  return asked;
}

const HEAD = GitOid.parse("6f24fa3fd3438f5ebe25018b5d6ba471bf119b45");
const BASE = GitOid.parse("e28c33e61b920728d79d099a9963ff23a865ef98");

describe("commitsFrom", () => {
  test("reads a jj source out of the live commit log", async () => {
    // arrange
    const entries = [
      {
        commitId: "c1",
        changeId: "k1",
        description: "one",
        parents: [],
        author: "someone@example.com",
        timestamp: "2026-01-01T00:00:00Z",
        refs: [],
        markers: [],
      },
    ];
    const asked = serve(entries);

    // act
    const commits = await commitsFrom({ kind: "jj", operation: null });

    // assert
    expect(commits).toEqual(entries);
    expect(asked).toEqual(["/api/log"]);
  });

  test("reads a jj source at the operation it names", async () => {
    // arrange
    const asked = serve([]);

    // act
    await commitsFrom({ kind: "jj", operation: "0a1b2c" });

    // assert
    expect(asked).toEqual(["/api/log?op=0a1b2c"]);
  });

  test("reads a pull source out of that head's commits", async () => {
    // arrange
    const asked = serve({
      head: HEAD,
      version: 7,
      base: BASE,
      commits: [
        {
          commitId: HEAD,
          parents: [BASE],
          description: "frontend: give the graph side-by-side branch lanes",
          author: "glencbz",
          authoredAt: "2026-09-10T09:00:00Z",
          changeId: "frontend: give the graph side-by-side branch lanes",
        },
      ],
    });

    // act
    const commits = await commitsFrom({
      kind: "pull",
      repo: "glencbz/diffy",
      number: 9,
      head: HEAD,
    });

    // assert
    expect(commits).toEqual([
      {
        commitId: HEAD,
        changeId: null,
        description: "frontend: give the graph side-by-side branch lanes",
        parents: [BASE],
        author: "glencbz",
        timestamp: "2026-09-10T09:00:00Z",
        refs: [],
        markers: [],
      },
    ]);
    expect(asked[0]).toBe(
      `/api/github/pull/commits?repo=glencbz%2Fdiffy&number=9&head=${HEAD}`,
    );
  });
});
```
## Commit log controller

```tsx
//| id: frontend-controller-commit-log
//| file: src/frontend/controllers/CommitLog.tsx
import type { Source } from "../model/history";
import { useCommits } from "../state/commits";
import { CommitGraph } from "../views/CommitGraph";
import { Message } from "../views/Message";

export function CommitLog({
  source,
  selected,
  onSelect,
  oldestFirst = false,
}: {
  source: Source;
  selected: string[];
  onSelect?: ((commitIds: string[]) => void) | undefined;
  oldestFirst?: boolean;
}) {
  const log = useCommits(source);

  if (log.status === "loading") return <Message>Loading commits...</Message>;
  if (log.status === "error") {
    return <Message tone="error">{log.message}</Message>;
  }

  return (
    <CommitGraph
      commits={log.data}
      selected={selected}
      onSelect={onSelect}
      oldestFirst={oldestFirst}
    />
  );
}
```

## Commit graph

`layoutGraph` is pure: commits in backend order, lanes and edges out. A
commit takes the leftmost lane already pointing at it, its first parent stays
there, and a merge's other parents fan out; a lane already pointing at a
parent absorbs the branch. The gutter draws in percentages of the row's
height, since the row grows with `--text-size`.

Rows select by commit id, never change id, which names a different version
in each operation's log. The selection comes back in log order, not click
order, or a series would line up in whatever order the reader clicked.

The pull request screen draws oldest first. `oldestFirst` reverses the rows
and mirrors each gutter, which is exact because every edge runs from a row's
top or bottom to its middle; a second layout pass would be a second
algorithm to keep in agreement.

```tsx
//| id: frontend-view-commit-graph
//| file: src/frontend/views/CommitGraph.tsx
import type { LogEntry } from "../model/history";
import { CommitLabel } from "./CommitLabel";

// A node and a half. One node per row, so a lane only separates parallel
// edges, and gutter width comes out of the label's.
const LANE_WIDTH = 12;
const LANE_CLASS_COUNT = 7;

// Lane zero stays grey, so a linear history is unchanged; branches get colour.
function laneClass(lane: number): string {
  return `commit-graph__lane--${lane % LANE_CLASS_COUNT}`;
}

export type GraphEdge = { from: number; to: number };

export type GraphRow = {
  /** Lane holding this commit's node. */
  lane: number;
  isMerge: boolean;
  /** Top-half segments, drawn from (from, y=0) to (to, y=middle). */
  incoming: GraphEdge[];
  /** Bottom-half segments, drawn from (from, y=middle) to (to, y=bottom). */
  outgoing: GraphEdge[];
};

export type GraphLayout = {
  rows: GraphRow[];
  /** Widest lane count any row reaches; drives the gutter width. */
  laneCount: number;
};

/**
 * Assign every commit a lane and the edges linking it to its parents. Input
 * order is the backend's: a child always precedes its parents. `lanes[i]` is
 * the commitId lane `i` is routing toward, or null when the lane is free.
 */
export function layoutGraph(commits: LogEntry[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 1;

  const firstFree = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const above = lanes.slice();

    // The node sits in the leftmost lane already routing to it, else a new one.
    const claimed = above
      .map((id, i) => (id === commit.commitId ? i : -1))
      .filter((i) => i !== -1);
    const lane = claimed.length > 0 ? (claimed[0] as number) : firstFree();

    // Every lane that was routing to this commit terminates at the node.
    for (const i of claimed) lanes[i] = null;
    lanes[lane] = null;

    const incoming: GraphEdge[] = [];
    for (let i = 0; i < above.length; i++) {
      if (above[i] === null) continue;
      incoming.push({ from: i, to: above[i] === commit.commitId ? lane : i });
    }

    // Route each parent: reuse a lane already heading there, else the node's
    // own lane for the first parent, else a free lane.
    const outgoing: GraphEdge[] = [];
    for (const [k, parent] of commit.parents.entries()) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = k === 0 ? lane : firstFree();
        lanes[target] = parent;
      }
      outgoing.push({ from: lane, to: target });
    }

    // Lanes that run straight through this row, unchanged.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && lanes[i] === above[i]) {
        outgoing.push({ from: i, to: i });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lane + 1, lanes.length, above.length);

    rows.push({
      lane,
      isMerge: commit.parents.length > 1,
      incoming,
      outgoing,
    });
  }

  return { rows, laneCount };
}

export function CommitGraph({
  commits: newestFirst,
  selected,
  onSelect,
  oldestFirst = false,
}: {
  commits: LogEntry[];
  selected: string[];
  /** Omit to draw a graph that is read but not picked from. */
  onSelect?: ((commitIds: string[]) => void) | undefined;
  /** Draw the oldest commit at the top rather than the newest. */
  oldestFirst?: boolean;
}) {
  const chosen = new Set(selected);

  function toggle(commitId: string, select: (commitIds: string[]) => void) {
    const next = new Set(chosen);
    if (next.has(commitId)) next.delete(commitId);
    else next.add(commitId);

    select(
      commits
        .filter((commit) => next.has(commit.commitId))
        .map((commit) => commit.commitId),
    );
  }

  const layout = layoutGraph(newestFirst);
  const commits = oldestFirst ? [...newestFirst].reverse() : newestFirst;
  const rows = oldestFirst ? [...layout.rows].reverse() : layout.rows;
  const gutterWidth = layout.laneCount * LANE_WIDTH;

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index] as GraphRow;
        const className = `commit-graph__row${
          chosen.has(commit.commitId) ? " commit-graph__row--selected" : ""
        }`;
        const content = (
          <>
            <RowGraphic row={row} width={gutterWidth} flipped={oldestFirst} />
            <CommitLabel commit={commit} />
          </>
        );

        return (
          <div key={commit.commitId} className={className}>
            {onSelect !== undefined && (
              <Tick
                label="✓"
                name={commit.commitId.slice(0, 8)}
                ticked={chosen.has(commit.commitId)}
                onTick={() => toggle(commit.commitId, onSelect)}
              />
            )}
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** The one control in a row: a cell down its left edge that ticks the
 *  commit in or out. */
function Tick({
  label,
  name,
  ticked,
  onTick,
}: {
  label: string;
  name: string;
  ticked: boolean;
  onTick: () => void;
}) {
  return (
    <button
      type="button"
      className="commit-graph__tick"
      aria-pressed={ticked}
      aria-label={name}
      onClick={onTick}
    >
      {label}
    </button>
  );
}

function RowGraphic({
  row,
  width,
  flipped,
}: {
  row: GraphRow;
  width: number;
  flipped: boolean;
}) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

  return (
    <svg
      width={width}
      className={`commit-graph__gutter${
        flipped ? " commit-graph__gutter--flipped" : ""
      }`}
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1="0"
          x2={x(edge.to)}
          y2="50%"
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1="50%"
          x2={x(edge.to)}
          y2="100%"
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy="50%"
        r={4}
        className={`commit-graph__node ${laneClass(row.lane)}${
          row.isMerge ? " commit-graph__node--merge" : ""
        }`}
      />
    </svg>
  );
}
```

Lanes cycle through `--graph-lane-N` as `color`, and edges and nodes draw in
`currentColor`. The gutter's width comes from the `<svg>`'s own attribute.

```css
/*| id: design-commit-graph
@layer components {
  .commit-graph__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: calc(40 / 12 * 1em);
    padding: 0 var(--space-4) 0 0;
    white-space: nowrap;
  }

  .commit-graph__row--selected {
    background: var(--surface-selected);
  }

  .commit-graph__tick {
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    justify-content: center;
    width: 2em;
    padding: 0;
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border-subtle);
  }

  .commit-graph__tick:hover {
    color: var(--accent);
    background: var(--surface-sunken);
  }

  .commit-graph__tick[aria-pressed="true"] {
    font-weight: bold;
    color: var(--text-inverse);
    background: var(--accent);
  }

  /* An <svg> with no height claims 150px; contain: size lets the label alone
     set the row's height. */
  .commit-graph__gutter {
    flex: none;
    align-self: stretch;
    contain: size;
  }

  .commit-graph__gutter--flipped {
    transform: scaleY(-1);
  }

  .commit-graph__edge {
    stroke: currentColor;
  }

  .commit-graph__node {
    stroke: currentColor;
    fill: currentColor;
  }

  .commit-graph__node--merge {
    fill: var(--surface);
  }

  .commit-graph__lane--0 {
    color: var(--graph-lane-0);
  }

  .commit-graph__lane--1 {
    color: var(--graph-lane-1);
  }

  .commit-graph__lane--2 {
    color: var(--graph-lane-2);
  }

  .commit-graph__lane--3 {
    color: var(--graph-lane-3);
  }

  .commit-graph__lane--4 {
    color: var(--graph-lane-4);
  }

  .commit-graph__lane--5 {
    color: var(--graph-lane-5);
  }

  .commit-graph__lane--6 {
    color: var(--graph-lane-6);
  }
}
```

The tick is the only control in a row, so the label stays text a reader can
select and copy, and a row is a plain `<div>` whether or not it picks. The
tick fills the row's height, so the whole strip down the left edge is a
target rather than a glyph. A pressed tick takes the accent, which reads
against the selected row's blue.

```css
/*| id: design-commit-graph
@layer components-narrow {
  /* The app's 44px touch target. */
  @media (max-width: 1000px) {
    .commit-graph__tick {
      width: 44px;
      min-height: 44px;
    }
  }
}
```

```tsx
//| id: frontend-view-commit-graph-test
//| file: src/frontend/views/CommitGraph.test.ts
import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../model/history";
import { layoutGraph } from "./CommitGraph";

function commit(id: string, parents: string[]): LogEntry {
  return {
    commitId: id,
    changeId: `${id}-change`,
    description: id,
    parents,
    author: "someone@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    refs: [],
    markers: [],
  };
}

describe("layoutGraph", () => {
  test("keeps a linear history in one lane", () => {
    const { rows, laneCount } = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.some((r) => r.isMerge)).toBe(false);
  });

  test("splits a fork and collapses the merge back to lane zero", () => {
    const { rows, laneCount } = layoutGraph([
      commit("m", ["l", "r"]),
      commit("l", ["base"]),
      commit("r", ["base"]),
      commit("base", []),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(rows.map((r) => r.isMerge)).toEqual([true, false, false, false]);
    // the merge node fans a second parent out into lane one...
    expect(rows[0]?.outgoing).toContainEqual({ from: 0, to: 1 });
    // ...and the right side branch routes back into lane zero.
    expect(rows[2]?.outgoing).toContainEqual({ from: 1, to: 0 });
  });
});
```
## Commit label

`CommitLabel` names a commit the way `jj log` does, metadata over the first
line of the description, for both the graph and the diff header. Every
standing jj reports goes on the metadata line, including `@` and `(empty)`,
which jj places elsewhere. A commit with no change id shows its short commit
id in italic in that slot and drops the duplicate: the two are different
promises, and drawing them alike would invite trusting the wrong one.

```tsx
//| id: frontend-view-commit-label
//| file: src/frontend/views/CommitLabel.tsx
import type { CommitMarker, CommitRef, LogEntry } from "../model/history";

const REFS: Record<CommitRef["kind"], string> = {
  bookmark: "commit-ref--bookmark",
  tag: "commit-ref--tag",
  "working-copy": "commit-ref--working-copy",
};

const MARKERS: Record<CommitMarker, { word: string; className: string }> = {
  "working-copy": { word: "@", className: "commit-marker--working-copy" },
  empty: { word: "(empty)", className: "commit-marker--empty" },
  conflict: { word: "conflict", className: "commit-marker--conflict" },
  divergent: { word: "divergent", className: "commit-marker--divergent" },
  hidden: { word: "hidden", className: "commit-marker--hidden" },
};

export function CommitLabel({ commit }: { commit: LogEntry }) {
  const summary = commit.description.split("\n")[0] ?? "";
  const shortCommitId = commit.commitId.slice(0, 8);
  const shortChangeId = commit.changeId?.slice(0, 8) ?? null;

  return (
    <span className="commit-label">
      <span className="commit-label__meta">
        <span
          className={
            shortChangeId !== null
              ? "commit-label__id"
              : "commit-label__id commit-label__id--synthetic"
          }
        >
          {shortChangeId ?? shortCommitId}
        </span>
        <span className="commit-label__author">{commit.author}</span>
        <time className="commit-label__time" dateTime={commit.timestamp}>
          <span className="commit-label__date">
            {commit.timestamp.slice(0, 10)}
          </span>{" "}
          <span className="commit-label__clock">
            {commit.timestamp.slice(11, 19)}
          </span>
        </time>
        {commit.refs.map((ref) => (
          <span
            key={`${ref.kind}:${ref.name}`}
            className={`commit-ref ${REFS[ref.kind]}`}
          >
            {ref.name}
          </span>
        ))}
        {shortChangeId !== null && (
          <span className="commit-label__commit-id">{shortCommitId}</span>
        )}
        {commit.markers.map((marker) => (
          <span
            key={marker}
            className={`commit-marker ${MARKERS[marker].className}`}
          >
            {MARKERS[marker].word}
          </span>
        ))}
      </span>
      <span className="commit-label__summary">
        {summary || (
          <em className="commit-label__placeholder">(no description)</em>
        )}
      </span>
    </span>
  );
}
```

Only the author and the timestamp truncate (the author four times as fast);
an eight-character id or a short word loses its meaning to one ellipsis.
`--ref-max-width` caps a long bookmark. Names and standings are coloured
text rather than chips, and both ids share one grey, since a lighter one
would fail WCAG AA at this size.

```css
/*| id: design-commit-label
@layer components {
  .commit-label {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    line-height: var(--text-line-height);
  }

  .commit-label__meta {
    display: flex;
    gap: var(--space-3);
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .commit-label__id {
    flex: none;
  }

  .commit-label__id--synthetic {
    font-style: italic;
  }

  .commit-label__author {
    flex: 0 4 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-label__time {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-label__commit-id {
    flex: none;
  }

  .commit-label__summary {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-label__placeholder {
    color: var(--text-ghost);
  }

  .commit-ref {
    flex: none;
    max-width: var(--ref-max-width);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-ref--bookmark {
    color: var(--ref-bookmark);
  }

  .commit-ref--tag {
    color: var(--ref-tag);
  }

  .commit-ref--working-copy {
    color: var(--ref-working-copy);
  }

  .commit-ref--working-copy::after {
    content: "@";
  }

  .commit-marker {
    flex: none;
  }

  .commit-marker--working-copy {
    color: var(--marker-working-copy);
  }

  .commit-marker--empty {
    color: var(--marker-empty);
  }

  .commit-marker--conflict {
    color: var(--marker-conflict);
  }

  .commit-marker--divergent {
    color: var(--marker-divergent);
  }

  .commit-marker--hidden {
    color: var(--marker-hidden);
  }
}
```

Below 1000px the metadata wraps rather than clipping, and narrower screens
drop the author, then the clock: a date still places a commit, a clock alone
does not.

```css
/*| id: design-commit-label
@layer components-narrow {
  @media (max-width: 1000px) {
    .commit-label__meta {
      flex-wrap: wrap;
      overflow: visible;
    }

    .commit-label__summary {
      overflow: visible;
      overflow-wrap: anywhere;
      white-space: normal;
    }
  }

  @media (max-width: 480px) {
    .commit-label__author {
      display: none;
    }
  }

  @media (max-width: 360px) {
    .commit-label__clock {
      display: none;
    }
  }
}
```
