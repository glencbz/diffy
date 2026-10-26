// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-view-console>>[init]
import { useState } from "react";
import { type Compared, isOnLogged } from "../../model/runSteps";
import type { Logged } from "../../model/runs";
import {
  CHANGE_MARK,
  CommentButton,
  type PartNotes,
  RowNotes,
} from "./Network";

export function Console({
  label,
  lines,
  notes,
}: {
  label: string;
  lines: Compared<Logged>[];
  /** Null where there is no review to keep comments in. */
  notes: PartNotes<Logged> | null;
}) {
  const [composing, setComposing] = useState<number | null>(null);
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {lines.length === 0 ? (
        <p className="run-panel__none">Nothing written to the console.</p>
      ) : (
        <ul className="run-list">
          {lines.map((each, index) => {
            const line = (each.after ?? each.before) as Logged;
            const threads =
              notes?.review.comments.filter((comment) =>
                isOnLogged(comment, line),
              ) ?? [];
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a console repeats itself, and the lines never reorder
                key={index}
                className={`run-row run-row--${each.change} run-log--${line.level}`}
              >
                <span className="run-row__head run-row__head--log">
                  <span className="run-row__change">
                    {CHANGE_MARK[each.change]}
                  </span>
                  <span className="run-log__level">{line.level}</span>
                  <span className="run-log__text">{line.text}</span>
                </span>
                {notes !== null && (
                  <>
                    <CommentButton
                      count={threads.length}
                      what={`${line.level} ${line.text}`}
                      onClick={() => setComposing(index)}
                    />
                    <RowNotes
                      review={notes.review}
                      threads={threads}
                      composing={
                        composing === index ? notes.anchorOf(line) : null
                      }
                      onDone={() => setComposing(null)}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
// ~/~ end
