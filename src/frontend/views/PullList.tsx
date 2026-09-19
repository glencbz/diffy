// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-list>>[init]
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullList({
  pulls,
  selected,
  onSelect,
}: {
  pulls: PullSummary[];
  selected: number | null;
  onSelect: (number: number) => void;
}) {
  return (
    <div>
      {pulls.map((pull) => (
        <button
          type="button"
          key={pull.number}
          onClick={() => onSelect(pull.number)}
          style={{
            display: "block",
            width: "100%",
            padding: "6px 8px",
            border: "none",
            borderBottom: "1px solid #eee",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            textAlign: "left",
            background: pull.number === selected ? "#d0e4ff" : "transparent",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}>#{pull.number}</span>
            <PullStateChip state={pull.state} />
          </span>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {pull.title}
          </span>
          <span style={{ color: "#888" }}>← {pull.baseRefName}</span>
        </button>
      ))}
    </div>
  );
}
// ~/~ end
