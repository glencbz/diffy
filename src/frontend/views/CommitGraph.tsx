// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-view-commit-graph>>[init]
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const ROW_HEIGHT = 40;
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
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string[];
  /** Omit to draw a graph that is read but not picked from. */
  onSelect?: ((commitIds: string[]) => void) | undefined;
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

  const { rows, laneCount } = layoutGraph(commits);
  const gutterWidth = laneCount * LANE_WIDTH;

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index] as GraphRow;
        const className = `commit-graph__row${
          chosen.has(commit.commitId) ? " commit-graph__row--selected" : ""
        }`;
        const content = (
          <>
            <RowGraphic row={row} width={gutterWidth} />
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

function RowGraphic({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      className="commit-graph__gutter"
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={0}
          x2={x(edge.to)}
          y2={middle}
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={middle}
          x2={x(edge.to)}
          y2={ROW_HEIGHT}
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={middle}
        r={4}
        className={`commit-graph__node ${laneClass(row.lane)}${
          row.isMerge ? " commit-graph__node--merge" : ""
        }`}
      />
    </svg>
  );
}
// ~/~ end
