// ~/~ begin <<docs/architecture/frontend/combined-graph.md#frontend-view-combined-graph>>[init]
import {
  type CombinedKind,
  combineLogs,
  layoutEntries,
  rowEntry,
  tick,
} from "../model/combinedLog";
import type { LogEntry } from "../model/history";
import {
  type GraphRow,
  LANE_WIDTH,
  layoutGraph,
  RowGraphic,
} from "./CommitGraph";
import { CommitLabel } from "./CommitLabel";

type Side = "before" | "after";

const CHIP: Record<CombinedKind, string | null> = {
  same: null,
  rewritten: "rewritten",
  new: "new",
  gone: "gone",
};

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
  const rows = combineLogs(before, after);
  const layout = layoutGraph(layoutEntries(rows));
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
              <Tick
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

function Tick({
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
        className="combined-graph__tick combined-graph__tick--absent"
        role="img"
        aria-label={`not in ${side}`}
      >
        ·
      </span>
    );
  }
  return (
    <button
      type="button"
      className="combined-graph__tick"
      aria-pressed={ticked}
      aria-label={`${side} ${entry.commitId.slice(0, 8)}`}
      onClick={() => onTick(entry.commitId)}
    >
      {side === "before" ? "B" : "A"}
    </button>
  );
}
// ~/~ end
