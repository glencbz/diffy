// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-drawer-bar>>[init]
import type { StackPosition } from "./PullReviewPanes";

export function DrawerBar({
  position: { index, count, summary },
  onStep,
}: {
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
}) {
  return (
    <div className="drawer-bar">
      <div className="drawer-bar__stepper">
        <button
          type="button"
          aria-label="previous commit"
          disabled={index === null || index === 0}
          onClick={() => onStep(-1)}
          className="drawer-bar__step"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="next commit"
          disabled={index === null ? count === 0 : index >= count - 1}
          onClick={() => onStep(1)}
          className="drawer-bar__step"
        >
          ›
        </button>
      </div>
      <p className="drawer-bar__where">
        <span className="drawer-bar__position">
          {index === null ? commitCount(count) : `${index + 1} of ${count}`}
        </span>
        <span className="drawer-bar__summary">{summary}</span>
      </p>
    </div>
  );
}

function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
// ~/~ end
