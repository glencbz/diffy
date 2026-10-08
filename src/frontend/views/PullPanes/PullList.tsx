// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-pull-list>>[init]
import type { PullSummary } from "../../model/pull";
import { PullStateChip } from "../PullStateChip";

export function PullList({
  pulls,
  selected,
  onSelect,
  guided,
}: {
  pulls: PullSummary[];
  selected: number | null;
  onSelect: (number: number) => void;
  /** Whether a pull request's newest head has a guide, on a guided read. */
  guided?: (pull: PullSummary) => boolean;
}) {
  return (
    <div>
      {pulls.map((pull) => (
        <button
          type="button"
          key={pull.number}
          onClick={() => onSelect(pull.number)}
          className={
            pull.number === selected
              ? "pull-list__item pull-list__item--selected"
              : "pull-list__item"
          }
        >
          <span className="pull-list__row">
            <span className="pull-list__number">#{pull.number}</span>
            <PullStateChip state={pull.state} />
            {guided?.(pull) && <span className="guided-chip">guided</span>}
          </span>
          <span className="pull-list__title">{pull.title}</span>
          <span className="pull-list__base">← {pull.baseRefName}</span>
        </button>
      ))}
    </div>
  );
}
// ~/~ end
