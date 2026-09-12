// ~/~ begin <<docs/architecture/frontend.md#frontend-view-commit-graph>>[init]
import type { LogEntry } from "../api";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;

// Lane zero stays grey, so a linear history is unchanged; branches get colour.
const LANE_COLORS = [
  "#333",
  "#0969da",
  "#1a7f37",
  "#8250df",
  "#bf8700",
  "#1b7c83",
  "#cf222e",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] as string;
}

export type GraphEdge = { from: number; to: number };

export type GraphRow = {
  changeId: string;
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
      changeId: commit.changeId,
      lane,
      isMerge: commit.parents.length > 1,
      incoming,
      outgoing,
    });
  }

  return { rows, laneCount };
}

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string | null;
  onSelect: (changeId: string) => void;
}) {
  const { rows, laneCount } = layoutGraph(commits);
  const gutterWidth = laneCount * LANE_WIDTH;

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index] as GraphRow;
        const isSelected = commit.changeId === selected;
        return (
          <button
            type="button"
            key={commit.changeId}
            onClick={() => onSelect(commit.changeId)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              height: ROW_HEIGHT,
              padding: 0,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              font: "inherit",
              textAlign: "left",
              background: isSelected ? "#d0e4ff" : "transparent",
            }}
          >
            <RowGraphic row={row} width={gutterWidth} />
            <span style={{ color: "#888", marginRight: 8 }}>
              {commit.changeId.slice(0, 8)}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {firstLine(commit.description) || (
                <em style={{ color: "#999" }}>(no description)</em>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RowGraphic({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={0}
          x2={x(edge.to)}
          y2={middle}
          stroke={laneColor(edge.to)}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={middle}
          x2={x(edge.to)}
          y2={ROW_HEIGHT}
          stroke={laneColor(edge.to)}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={middle}
        r={4}
        fill={row.isMerge ? "#fff" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
      />
    </svg>
  );
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
// ~/~ end
