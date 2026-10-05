// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-mode-switch>>[init]
import type { DiffMode } from "../../../model/settings";

const DIFF_MODES: { value: DiffMode; caption: string }[] = [
  { value: "structural", caption: "structural" },
  { value: "line", caption: "lines" },
];

/** Which view one file is drawn in. The structural button is off, with the
 *  reason as its title, when difftastic has nothing for the file. */
export function DiffModeSwitch({
  mode,
  unavailable,
  onChoose,
}: {
  mode: DiffMode;
  unavailable: string | null;
  onChoose: (mode: DiffMode) => void;
}) {
  return (
    <fieldset className="diff-file__modes" aria-label="Diff view">
      {DIFF_MODES.map(({ value, caption }) => {
        const off = value === "structural" && unavailable !== null;
        return (
          <button
            key={value}
            type="button"
            className="diff-file__mode"
            aria-pressed={mode === value}
            disabled={off}
            title={off ? `No structural diff: ${unavailable}` : undefined}
            onClick={() => onChoose(value)}
          >
            {caption}
          </button>
        );
      })}
    </fieldset>
  );
}
// ~/~ end
