# Combined graph

An interdiff's [one-graph arrangement](local-history.md#the-screen) draws the
before and the after operation's logs as one graph, a row per change, with a
before tick and an after tick on each row. Where the two graphs side by side
leave the reader to find a change's row in each, here it is one row that says
how the change moved between the operations.

## Combining two logs

A row is a change, keyed by its change id, since that is what survives a
rewrite. A change id stops naming one row when it is divergent on either side
or missing, as on a git commit, so its entries on both sides fall back to their
commit ids: a divergent commit that is still there lines up with itself, and
the copy that is not stands alone. jj prints change ids in `k` to `z` and
commit ids in hex, so the two kinds of key cannot collide.

A row's edges are the after entry's parents, or the before entry's on a row
the after log lacks, translated to row keys. Rows follow the after log, so a
child still precedes its parents, which is all `layoutGraph` asks. A gone row
goes just ahead of the next row in the before log that the after log still
has, which is where its parent usually is.

```ts
//| id: frontend-model-combined-log
//| file: src/frontend/model/combinedLog.ts
import type { LogEntry } from "./history";

/** How a change moved between the before and the after operation. */
export type CombinedKind = "same" | "rewritten" | "new" | "gone";

export type CombinedRow = {
  /** The change id, or the commit id where a change id names no one row. */
  key: string;
  /** Row keys of the parents the graph draws. */
  parents: string[];
} & (
  | { kind: "same" | "rewritten"; before: LogEntry; after: LogEntry }
  | { kind: "new"; before: null; after: LogEntry }
  | { kind: "gone"; before: LogEntry; after: null }
);

/** The entry a row is labelled with: the after one unless the change is gone. */
export function rowEntry(row: CombinedRow): LogEntry {
  return row.kind === "gone" ? row.before : row.after;
}

/** Change ids that appear more than once on either side. */
function divergent(logs: LogEntry[][]): Set<string> {
  const found = new Set<string>();
  for (const log of logs) {
    const seen = new Set<string>();
    for (const { changeId } of log) {
      if (changeId === null) continue;
      if (seen.has(changeId)) found.add(changeId);
      seen.add(changeId);
    }
  }
  return found;
}

export function combineLogs(
  before: LogEntry[],
  after: LogEntry[],
): CombinedRow[] {
  const ambiguous = divergent([before, after]);
  const keyOf = ({ changeId, commitId }: LogEntry) =>
    changeId === null || ambiguous.has(changeId) ? commitId : changeId;
  const beforeKeys = new Map(before.map((e) => [e.commitId, keyOf(e)]));
  const afterKeys = new Map(after.map((e) => [e.commitId, keyOf(e)]));
  const beforeByKey = new Map(before.map((e) => [keyOf(e), e]));
  const kept = new Set(afterKeys.values());

  const parents = (entry: LogEntry, keys: Map<string, string>) =>
    entry.parents.map((parent) => keys.get(parent) ?? parent);

  // Each gone entry waits for the next before entry the after log still has.
  const goneAhead = new Map<string, LogEntry[]>();
  let waiting: LogEntry[] = [];
  for (const entry of before) {
    const key = keyOf(entry);
    if (!kept.has(key)) {
      waiting.push(entry);
    } else if (waiting.length > 0) {
      goneAhead.set(key, waiting);
      waiting = [];
    }
  }

  const gone = (entry: LogEntry): CombinedRow => ({
    key: keyOf(entry),
    parents: parents(entry, beforeKeys),
    kind: "gone",
    before: entry,
    after: null,
  });

  const rows: CombinedRow[] = [];
  for (const entry of after) {
    const key = keyOf(entry);
    rows.push(...(goneAhead.get(key) ?? []).map(gone));
    const was = beforeByKey.get(key);
    const common = { key, parents: parents(entry, afterKeys), after: entry };
    rows.push(
      was === undefined
        ? { ...common, kind: "new", before: null }
        : {
            ...common,
            kind: was.commitId === entry.commitId ? "same" : "rewritten",
            before: was,
          },
    );
  }
  rows.push(...waiting.map(gone));
  return rows;
}

/** The rows as log entries `layoutGraph` can lay out, one per row, linked by
 *  row key, so the combined graph needs no layout of its own. */
export function layoutEntries(rows: CombinedRow[]): LogEntry[] {
  return rows.map((row) => ({
    ...rowEntry(row),
    commitId: row.key,
    parents: row.parents,
  }));
}

/** A side's selection with `commitId` ticked or unticked, in that side's own
 *  log order, as its own graph would emit it. */
export function tick(
  log: LogEntry[],
  selected: string[],
  commitId: string,
): string[] {
  const next = new Set(selected);
  if (next.has(commitId)) next.delete(commitId);
  else next.add(commitId);
  return log
    .filter((entry) => next.has(entry.commitId))
    .map((entry) => entry.commitId);
}
```

```ts
//| id: frontend-model-combined-log-test
//| file: src/frontend/model/combinedLog.test.ts
import { describe, expect, test } from "bun:test";
import { combineLogs, layoutEntries, tick } from "./combinedLog";
import type { LogEntry } from "./history";

function entry(
  commitId: string,
  changeId: string | null,
  parents: string[] = [],
): LogEntry {
  return {
    commitId,
    changeId,
    description: commitId,
    parents,
    author: "someone@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    refs: [],
    markers: [],
  };
}

describe("combineLogs", () => {
  test("names how each change moved between the operations", () => {
    // arrange
    const before = [
      entry("c2", "kept", ["c1"]),
      entry("d1", "dropped", ["c1"]),
      entry("c1", "base"),
    ];
    const after = [
      entry("n1", "added", ["c3"]),
      entry("c3", "kept", ["c1"]),
      entry("c1", "base"),
    ];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["added", "new"],
      ["kept", "rewritten"],
      ["dropped", "gone"],
      ["base", "same"],
    ]);
    expect(rows[1]?.before?.commitId).toBe("c2");
    expect(rows[1]?.after?.commitId).toBe("c3");
  });

  test("puts a gone row ahead of the next before row the after log keeps", () => {
    // arrange
    const before = [
      entry("g1", "gone-top", ["k2"]),
      entry("k2", "kept-2", ["g2"]),
      entry("g2", "gone-mid", ["k1"]),
      entry("k1", "kept-1"),
    ];
    const after = [entry("k2", "kept-2", ["k1"]), entry("k1", "kept-1")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => row.key)).toEqual([
      "gone-top",
      "kept-2",
      "gone-mid",
      "kept-1",
    ]);
  });

  test("keeps a gone row the after log has nothing below at the end", () => {
    // act
    const rows = combineLogs(
      [entry("a", "a"), entry("old", "old")],
      [entry("a", "a")],
    );

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["a", "same"],
      ["old", "gone"],
    ]);
  });

  test("keys a divergent change by commit id on both sides", () => {
    // arrange
    const before = [entry("x1", "twin")];
    const after = [entry("x1", "twin"), entry("x2", "twin")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["x1", "same"],
      ["x2", "new"],
    ]);
  });

  test("keys an entry with no change id by commit id", () => {
    // act
    const rows = combineLogs([entry("g1", null)], [entry("g2", null)]);

    // assert
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["g2", "new"],
      ["g1", "gone"],
    ]);
  });

  test("draws a row's parents from the after entry, as row keys", () => {
    // arrange
    const before = [entry("c2", "child", ["p1"]), entry("p1", "parent")];
    const after = [entry("c3", "child", ["p2"]), entry("p2", "parent")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows[0]?.parents).toEqual(["parent"]);
  });

  test("draws a gone row's parents from the before entry", () => {
    // arrange
    const before = [entry("g", "gone", ["b1"]), entry("b1", "base")];
    const after = [entry("b2", "base")];

    // act
    const rows = combineLogs(before, after);

    // assert
    expect(rows[0]).toMatchObject({ key: "gone", parents: ["base"] });
  });
});

describe("layoutEntries", () => {
  test("links the rows by key, labelled as the row is", () => {
    // arrange
    const rows = combineLogs(
      [entry("g", "gone", ["b1"]), entry("b1", "base")],
      [entry("b2", "base")],
    );

    // act
    const entries = layoutEntries(rows);

    // assert
    expect(entries.map((e) => [e.commitId, e.parents, e.description])).toEqual([
      ["gone", ["base"], "g"],
      ["base", [], "b2"],
    ]);
  });
});

describe("tick", () => {
  const log = [entry("c", "c"), entry("b", "b"), entry("a", "a")];

  test("adds a commit in log order, not click order", () => {
    expect(tick(log, ["a"], "c")).toEqual(["c", "a"]);
  });

  test("removes a ticked commit", () => {
    expect(tick(log, ["c", "a"], "a")).toEqual(["c"]);
  });
});
```

## Drawing it

Each row starts with its two ticks, `B` and `A`, so a reader's eye runs down
one column per side; the graph and the label follow, as in the
[commit graph](commit-history.md#commit-graph), whose gutter it reuses. A side
the change is absent from shows an inert dot in place of its tick. A chip
says how the change moved, except on a row that did not, which is most of
them. A gone row fades and strikes its subject, since its label comes from an
operation the after side no longer shows.

Each tick toggles its own side's selection and emits it in that side's log
order, so the diff pane receives exactly what two graphs would have sent it.

```tsx
//| id: frontend-view-combined-graph
//| file: src/frontend/views/CombinedGraph.tsx
import {
  type CombinedKind,
  type CombinedRow,
  combineLogs,
  layoutEntries,
  rowEntry,
  tick,
} from "../model/combinedLog";
import type { LogEntry } from "../model/history";
import {
  type GraphLayout,
  type GraphRow,
  LANE_WIDTH,
  layoutGraph,
  RowGraphic,
  Tick,
} from "./CommitGraph";
import { CommitLabel } from "./CommitLabel";

type Side = "before" | "after";

const CHIP: Record<CombinedKind, string | null> = {
  same: null,
  rewritten: "rewritten",
  new: "new",
  gone: "gone",
};

type Combined = { rows: CombinedRow[]; layout: GraphLayout };

// Kept logs come back as the same arrays, so the pair keys its combination
// and toggling between one graph and two redoes neither.
const combined = new WeakMap<LogEntry[], WeakMap<LogEntry[], Combined>>();

function combinedOf(before: LogEntry[], after: LogEntry[]): Combined {
  let byAfter = combined.get(before);
  if (byAfter === undefined) {
    byAfter = new WeakMap();
    combined.set(before, byAfter);
  }
  let pair = byAfter.get(after);
  if (pair === undefined) {
    const rows = combineLogs(before, after);
    pair = { rows, layout: layoutGraph(layoutEntries(rows)) };
    byAfter.set(after, pair);
  }
  return pair;
}

export function CombinedGraph({
  before,
  after,
  selected,
  onSelect,
}: {
  before: LogEntry[];
  after: LogEntry[];
  selected: Record<Side, string[]>;
  onSelect: (side: Side, commitIds: string[]) => void;
}) {
  const { rows, layout } = combinedOf(before, after);
  const gutterWidth = layout.laneCount * LANE_WIDTH;
  const logs = { before, after };
  const chosen = {
    before: new Set(selected.before),
    after: new Set(selected.after),
  };

  return (
    <div>
      {rows.map((row, index) => {
        const ticked = (side: Side) => {
          const entry = row[side];
          return entry !== null && chosen[side].has(entry.commitId);
        };
        const chip = CHIP[row.kind];
        const className = [
          "commit-graph__row",
          ticked("before") || ticked("after")
            ? "commit-graph__row--selected"
            : "",
          row.kind === "gone" ? "combined-graph__row--gone" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={row.key} className={className}>
            {(["before", "after"] as const).map((side) => (
              <SideTick
                key={side}
                side={side}
                entry={row[side]}
                ticked={ticked(side)}
                onTick={(commitId) =>
                  onSelect(side, tick(logs[side], selected[side], commitId))
                }
              />
            ))}
            <RowGraphic
              row={layout.rows[index] as GraphRow}
              width={gutterWidth}
              flipped={false}
            />
            <CommitLabel commit={rowEntry(row)} />
            {chip !== null && (
              <span
                className={`combined-graph__chip combined-graph__chip--${row.kind}`}
              >
                {chip}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SideTick({
  side,
  entry,
  ticked,
  onTick,
}: {
  side: Side;
  entry: LogEntry | null;
  ticked: boolean;
  onTick: (commitId: string) => void;
}) {
  if (entry === null) {
    return (
      <span
        className="commit-graph__tick combined-graph__absent"
        role="img"
        aria-label={`not in ${side}`}
      >
        ·
      </span>
    );
  }
  return (
    <Tick
      label={side === "before" ? "B" : "A"}
      name={`${side} ${entry.commitId.slice(0, 8)}`}
      ticked={ticked}
      onTick={() => onTick(entry.commitId)}
    />
  );
}
```

Each side's tick is the commit graph's, lettered for its side. A commit
missing from a side holds that column with a ghost dot, so the B and A
columns stay straight down the graph.

```css
/*| id: design-combined-graph
@layer components {
  /* A button is border-box and the absent tick's <span> is not; without this
     the span's border pushes its row's gutter a pixel right. */
  .combined-graph__absent {
    box-sizing: border-box;
    color: var(--text-ghost);
    cursor: default;
  }

  .combined-graph__absent:hover {
    color: var(--text-ghost);
    background: transparent;
  }

  .combined-graph__chip {
    flex: none;
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    border: 1px solid currentColor;
    border-radius: var(--radius);
  }

  .combined-graph__chip--rewritten {
    color: var(--status-modified);
  }

  .combined-graph__chip--new {
    color: var(--diff-added);
  }

  .combined-graph__chip--gone {
    color: var(--diff-removed);
  }

  .combined-graph__row--gone .commit-label {
    opacity: 0.6;
  }

  .combined-graph__row--gone .commit-label__summary {
    text-decoration: line-through;
  }
}
```

## Combined log controller

The controller loads both operations' logs and draws the graph once both are
in, since a row's kind needs both.

```tsx
//| id: frontend-controller-combined-log
//| file: src/frontend/controllers/CombinedLog.tsx
import { useCommits } from "../state/commits";
import { CombinedGraph } from "../views/CombinedGraph";
import { Message } from "../views/Message";

export function CombinedLog({
  operations,
  selected,
  onSelect,
}: {
  operations: Record<"before" | "after", string>;
  selected: Record<"before" | "after", string[]>;
  onSelect: (side: "before" | "after", commitIds: string[]) => void;
}) {
  const before = useCommits({ kind: "jj", operation: operations.before });
  const after = useCommits({ kind: "jj", operation: operations.after });

  if (before.status === "error") {
    return <Message tone="error">{before.message}</Message>;
  }
  if (after.status === "error") {
    return <Message tone="error">{after.message}</Message>;
  }
  if (before.status === "loading" || after.status === "loading") {
    return <Message>Loading commits...</Message>;
  }

  return (
    <CombinedGraph
      before={before.data}
      after={after.data}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
```
