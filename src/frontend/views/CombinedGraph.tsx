// ~/~ begin <<docs/architecture/frontend/combined-graph.md#frontend-view-combined-graph>>[init]
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
// ~/~ end
