// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-state-chip>>[init]
import type { PullState } from "../api";

const CHIP_COLORS: Record<PullState, string> = {
  OPEN: "#1a7f37",
  MERGED: "#8250df",
  CLOSED: "#cf222e",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span
      style={{
        flex: "none",
        padding: "0 6px",
        borderRadius: 3,
        background: CHIP_COLORS[state],
        color: "#fff",
        fontSize: 11,
      }}
    >
      {state.toLowerCase()}
    </span>
  );
}
// ~/~ end
