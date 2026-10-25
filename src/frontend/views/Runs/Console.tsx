// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-view-console>>[init]
import type { Compared } from "../../model/runSteps";
import type { Logged } from "../../model/runs";
import { CHANGE_MARK } from "./Network";

export function Console({
  label,
  lines,
}: {
  label: string;
  lines: Compared<Logged>[];
}) {
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {lines.length === 0 ? (
        <p className="run-panel__none">Nothing written to the console.</p>
      ) : (
        <ul className="run-list">
          {lines.map((each, index) => {
            const line = (each.after ?? each.before) as Logged;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a console repeats itself, and the lines never reorder
                key={index}
                className={`run-row run-row--${each.change} run-log--${line.level}`}
              >
                <span className="run-row__change">
                  {CHANGE_MARK[each.change]}
                </span>
                <span className="run-log__level">{line.level}</span>
                <span className="run-log__text">{line.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
// ~/~ end
