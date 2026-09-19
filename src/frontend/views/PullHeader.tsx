// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-header>>[init]
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullHeader({ pull }: { pull: PullSummary }) {
  return (
    <header
      style={{
        display: "flex",
        flex: "none",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        background: "#f0f0f0",
        borderBottom: "1px solid #ccc",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "#888" }}>#{pull.number}</span>
      <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {pull.title}
      </strong>
      <PullStateChip state={pull.state} />
      <span style={{ color: "#888" }}>base: {pull.baseRefName}</span>
      <span style={{ color: "#888" }}>{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "#0969da" }}
      >
        github
      </a>
    </header>
  );
}
// ~/~ end
