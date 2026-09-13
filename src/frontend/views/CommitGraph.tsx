// ~/~ begin <<docs/architecture/frontend.md#frontend-view-commit-graph>>[init]
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string | null;
  onSelect: (commitId: string) => void;
}) {
  return (
    <div>
      {commits.map((commit, index) => {
        const isSelected = commit.commitId === selected;
        return (
          <button
            type="button"
            key={commit.commitId}
            onClick={() => onSelect(commit.commitId)}
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
            <Lane
              hasAbove={index > 0}
              hasBelow={index < commits.length - 1}
              isMerge={commit.parents.length > 1}
            />
            <CommitLabel commit={commit} />
          </button>
        );
      })}
    </div>
  );
}

function Lane({
  hasAbove,
  hasBelow,
  isMerge,
}: {
  hasAbove: boolean;
  hasBelow: boolean;
  isMerge: boolean;
}) {
  const center = LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;
  return (
    <svg
      width={LANE_WIDTH}
      height={ROW_HEIGHT}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      {hasAbove && (
        <line x1={center} y1={0} x2={center} y2={middle} stroke="#999" />
      )}
      {hasBelow && (
        <line
          x1={center}
          y1={middle}
          x2={center}
          y2={ROW_HEIGHT}
          stroke="#999"
        />
      )}
      <circle
        cx={center}
        cy={middle}
        r={4}
        fill={isMerge ? "#fff" : "#333"}
        stroke="#333"
      />
    </svg>
  );
}
// ~/~ end
