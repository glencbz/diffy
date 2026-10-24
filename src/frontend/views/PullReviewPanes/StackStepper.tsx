// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-stack-stepper>>[init]
import type { StackPosition } from "./PullReviewPanes";

export function StackStepper({
  position: { index, count, summary },
  onStep,
}: {
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
}) {
  return (
    <div className="stack-stepper">
      <div className="stack-stepper__stepper">
        <button
          type="button"
          aria-label="previous commit"
          disabled={index === null || index === 0}
          onClick={() => onStep(-1)}
          className="stack-stepper__step"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="next commit"
          disabled={index === null ? count === 0 : index >= count - 1}
          onClick={() => onStep(1)}
          className="stack-stepper__step"
        >
          ›
        </button>
      </div>
      <p className="stack-stepper__where">
        <span className="stack-stepper__position">
          {index === null ? commitCount(count) : `${index + 1} of ${count}`}
        </span>
        <span className="stack-stepper__summary">{summary}</span>
      </p>
    </div>
  );
}

function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
// ~/~ end
