// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-state-chip>>[init]
import type { PullState } from "../api";

const CHIP_CLASS: Record<PullState, string> = {
  OPEN: "chip--open",
  MERGED: "chip--merged",
  CLOSED: "chip--closed",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span className={`chip ${CHIP_CLASS[state]}`}>{state.toLowerCase()}</span>
  );
}
// ~/~ end
