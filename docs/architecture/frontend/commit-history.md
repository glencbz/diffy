# Commit history

The commit list a side is picked from, drawn as a graph. Both screens mount
it, the local one over a jj operation and the pull request one over a fetched
head.

## Loading a side's commits

`useCommits` takes a side's `Source` and reloads whenever it changes, dropping
a response that lands after the source has moved on again. `commitsFrom` is the
one place in the app that dispatches on `source.kind`, so adding a third kind
of source is one branch here and nothing anywhere else.

A git commit has no change id, and `commitsFrom` leaves the field null rather
than filling it with the commit id. A row names both ids, so a commit id
standing in for a change id would print twice, and the two are not
interchangeable: a change id survives an amend and a commit id does not. The
row falls back to the short oid on its own, which is how GitHub names the same
commit on the same screen, and `reviewKey` reads the null as its cue to key a
mark by revision.

A source is an object, freshly built every render, so the effect cannot depend
on it directly without restarting on every render. It depends on the source's
JSON instead and reads the source back out of that JSON, which keeps one source
of truth rather than a dependency list that has to be kept in step with the
body by hand.

```tsx
//| id: frontend-state-commits
//| file: src/frontend/state/commits.ts
import { useEffect, useState } from "react";
import {
  fetchLog,
  fetchPullCommits,
  type GitCommit,
  type LogEntry,
  type Source,
} from "../api";
import type { AsyncState } from "./asyncState";

function asLogEntry(commit: GitCommit): LogEntry {
  return {
    commitId: commit.commitId,
    // A GitCommit carries an identity, but it is a subject line, and
    // `changeId` on a LogEntry is what the graph prints as the commit's id.
    // The pairing reads the identity off the GitCommit instead.
    changeId: null,
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

  const { commits } = await fetchPullCommits(
    source.repo,
    source.number,
    source.head,
  );
  return commits.map(asLogEntry);
}

export function useCommits(source: Source): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });
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

The dispatch is tested through `commitsFrom`, which is a plain async function,
so the test needs no renderer. It serves one canned response and checks both
the commits that come back and the URL that was asked for. The values alone
would not catch a source reaching the wrong endpoint and being parsed anyway.

```ts
//| id: frontend-state-commits-test
//| file: src/frontend/state/commits.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { GitOid } from "../api";
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
import type { Source } from "../api";
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

Side-by-side branch lanes. One node per commit, top to bottom in the order the
backend sent them, where a child always lands above its parents. Each lane
tracks the commit it is currently routing toward. A commit takes the leftmost
lane already pointing at it, or a fresh lane when none is. Its first parent
stays in that lane; the extra parents of a merge fan out into their own lanes,
and a commit with more than one parent draws as a hollow node. A lane that
already points at a parent absorbs the incoming branch instead of doubling up,
which is how a side branch collapses back into its base.

`layoutGraph` is the whole algorithm, and it is pure, commits in, lanes and
edges out. The view turns each row into an `<svg>` gutter as tall as the
row. A row's height follows its label, and the label grows with
`--text-size`, so the gutter draws in
percentages of its height and never in pixels. A fixed-height gutter beside
a taller label leaves a gap in every lane. Lane colour is
cycled by index so parallel branches stay distinct, and lane zero stays grey,
so a linear history looks the same as `jj log`.

Clicking a row toggles that commit by commit id, never by the change id the
label leads with. The two are not interchangeable as identifiers. A change id names whichever version of a commit
the current view holds, so it says something different in each operation's log,
and a selection has to keep meaning the one commit the reader clicked.

Any number of rows can be selected, and the graph hands back the whole
selection rather than the row that was clicked. It orders that selection the
way the log is ordered, because it is the only piece of the app that knows what
the order is. Click order would line a series up against the other side in
whatever sequence the reader happened to click.

`onSelect` is optional. Without it the same graph draws a history that is read
rather than picked from.

The pull request screen also draws its graph oldest first, the order its
commits are meant to be read in. `layoutGraph` still runs over the backend's
newest-first order, and `oldestFirst` reverses the rows it hands back and
mirrors each row's gutter top to bottom. Every edge a row draws runs from its
top edge to its middle or from its middle to its bottom, so the mirror image of
a row is exactly the row the reversed history needs, lane colours included. A
second layout pass that walked parents before children would be a second
algorithm to keep agreeing with the first.

```tsx
//| id: frontend-view-commit-graph
//| file: src/frontend/views/CommitGraph.tsx
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const LANE_WIDTH = 24;
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

        return onSelect === undefined ? (
          <div key={commit.commitId} className={className}>
            {content}
          </div>
        ) : (
          <button
            type="button"
            key={commit.commitId}
            onClick={() => toggle(commit.commitId, onSelect)}
            className={`${className} commit-graph__row--interactive`}
          >
            {content}
          </button>
        );
      })}
    </div>
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

CommitGraph reads its edge and node colours off a seven-step lane ramp
instead of picking one by hand: a lane's index selects one of the
`--graph-lane-N` roles as `color`, and the line and circle underneath both
draw in `currentColor`, so an edge always agrees with the node it meets.

The gutter is the one width the stylesheet does not set. It depends on how many
lanes a history happens to use, and the `<svg>` already carries that number
in its own `width` attribute, so a rule here would be a second copy of a
figure the markup has. The height is the stylesheet's. The gutter stretches
to the row, and the row has a floor of forty pixels at the standard text
size, written in `em` so the floor grows with the text. An `<svg>` with no
height of its own claims 150 pixels, which would make every row that tall.
`contain: size` withdraws that claim, so only the label decides how tall a
row is.

```css
/*| id: design-commit-graph
@layer components {
  .commit-graph__row {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: calc(40 / 12 * 1em);
    padding: 0 var(--space-4) 0 0;
    border: none;
    white-space: nowrap;
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
  }

  .commit-graph__row--selected {
    background: var(--surface-selected);
  }

  .commit-graph__row--interactive {
    cursor: pointer;
  }

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

A test pins the lane arithmetic: a linear run stays in lane zero, and a
fork/merge diamond puts the merge on a hollow node and collapses the side
branch back to lane zero.

```tsx
//| id: frontend-view-commit-graph-test
//| file: src/frontend/views/CommitGraph.test.ts
import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../api";
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

The graph rows and the diff panel's header both name a commit the same way,
and they name it the way `jj log` does: a line of metadata over the first line
of the description. One component, so the two never drift apart, and a reader
who knows the terminal already knows the row.

The metadata line follows jj's order. The change id, who wrote it, when, the
names pointing at it, the commit id, and then the standings jj reports. Every
standing lands there, including the two jj puts elsewhere: `@` for the
working copy, which jj spends a glyph column on, and `(empty)`, which jj puts
in front of the description. One list renders as one map over one array, where
jj's placement would scatter five values over three places for no gain a
reader can use.

A commit with no change id falls back to its short commit id, in italic, and
drops the commit id from jj's position rather than printing the same eight
characters twice. The two are not the same promise. A change id is the
commit's identity across a rewrite; a commit id names one revision and does
not survive an amend. Rendering them identically would invite a reader to
trust the wrong one. The cue stays small and stays in the same dim grey,
because on a git-backed row this is ordinary, not an error.

The `<time>` element carries the full timestamp the backend sent, so the
offset survives in the markup even though the text is trimmed to the seconds
`jj log` shows. It is cut at the `T` into a date and a clock rather than
printed as one string, because the two are worth different amounts of the
line and a narrow window keeps only the first. `REFS` and `MARKERS` are maps from a union to a class name and
a word, matching the rest of the app: a kind jj grows is a row in a table and
a type error until it has one.

```tsx
//| id: frontend-view-commit-label
//| file: src/frontend/views/CommitLabel.tsx
import type { CommitMarker, CommitRef, LogEntry } from "../api";

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

A label is two stacked lines, the way `jj log` writes one: metadata over the
description. The metadata line is the smaller type and a muted colour, so a
pane of them still scans as a list of descriptions.

`.commit-label__id--synthetic` is the one modifier this label needs.
Everything else about a commit's line is the same shape whether the id is a
change id or a stand-in for one.

The metadata line holds more than a narrow pane can show, and only the two
fields that survive being cut short give up any of it. The author yields four
times as fast as the timestamp, and an id, a name and a marker yield nothing:
a pane too narrow for the line reads `glencbz@gm…` and keeps `main`, the
commit id and the `conflict` whole.

That is a rule about ellipses more than about priority. A token here is eight
characters or one short word, so shrinking it by a pixel costs it a character
and then a second one for the ellipsis, and `main` becomes `ma…` for a
rounding error. Only a field long enough to read once truncated can be asked
to truncate, and `--ref-max-width` caps a name at its own expense rather than
letting one long bookmark push the line apart.

A phone is that rule with nothing left over. At 390 pixels the two fields
that were long enough stop being long enough, and the line reads `verif…` and
`04:…`, which answer nothing and cost the room a whole field would have sat
in. So the metadata wraps rather than clipping, and where even two lines will
not do, the fastest-yielding field leaves entirely: the author first, since
it was always the first to break, and then the clock. A date without its
clock still places a commit in the history, which is what a picker is asked;
a clock without its date places nothing.

A name and a standing are each a colour rather than a chip. The line is
already dense at eleven pixels, and a row of filled pills at that size reads
as furniture rather than as the handful of words jj colours in a terminal.

Neither id carries a colour of its own. Both inherit the line's one muted
grey, and the change id leads while the commit id follows the names, which is
the order `jj log` reads in and enough to tell them apart. Grading them by
lightness instead would have cost the fainter of the two its WCAG AA contrast
at eleven pixels, for a hierarchy their positions already carry.

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

Below a thousand pixels the label has the window to itself and can spend a
second line on the metadata, so the clipping stops there. The two widths
under it are where a second line is not enough either, and each drops the
field that has the least left to say.

```css
/*| id: design-commit-label
@layer components-narrow {
  @media (max-width: 1000px) {
    .commit-label__meta {
      flex-wrap: wrap;
      overflow: visible;
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
