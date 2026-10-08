// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-gap-line>>[init]
import type { GapEdge } from "./drawnLines";

/** Lines one press opens from an end of a long gap. */
const STEP = 20;

/** Unchanged lines a patch leaves out. A short gap opens whole with one
 *  press; a long one opens a step at a time from whichever end meets a
 *  hunk, or whole. */
export function GapLine({
  count,
  edge,
  onOpen,
}: {
  count: number;
  edge: GapEdge;
  /** Opens this many more lines from the top and from the bottom. */
  onOpen: (top: number, bottom: number) => void;
}) {
  const lines = `${count} unchanged ${count === 1 ? "line" : "lines"}`;
  if (count <= STEP + 5) {
    return (
      <button
        type="button"
        className="diff-line diff-line--gap"
        onClick={() => onOpen(count, 0)}
      >
        <span className="diff-line__gutter">⋯</span>
        <span>show {lines}</span>
      </button>
    );
  }
  return (
    <div className="diff-line diff-line--gap diff-line--steps">
      <span className="diff-line__gutter">⋯</span>
      <span>
        {lines}
        {edge === "top" ? " above" : edge === "bottom" ? " below" : ""}
      </span>
      {edge !== "top" && (
        <button
          type="button"
          className="diff-line__step"
          onClick={() => onOpen(STEP, 0)}
        >
          ↓ {STEP}
        </button>
      )}
      {edge !== "bottom" && (
        <button
          type="button"
          className="diff-line__step"
          onClick={() => onOpen(0, STEP)}
        >
          ↑ {STEP}
        </button>
      )}
      <button
        type="button"
        className="diff-line__step"
        onClick={() => onOpen(count, 0)}
      >
        all {count}
      </button>
    </div>
  );
}
// ~/~ end
