// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-panes>>[init]
import type { ReactNode } from "react";
import type { PullSummary } from "../../model/pull";
import { PullStateChip } from "./PullStateChip";

export type PullChoice =
  | { phase: "browsing" }
  | { phase: "reviewing"; pull: PullSummary }
  | { phase: "picking"; pull: PullSummary };

export function PullPanes({
  choice,
  onOpen,
  onDismiss,
  list,
  review,
}: {
  choice: PullChoice;
  onOpen: () => void;
  onDismiss: () => void;
  list: ReactNode;
  review: ReactNode;
}) {
  return (
    <>
      {choice.phase !== "browsing" && (
        <button type="button" onClick={onOpen} className="pull-bar">
          <span className="pull-bar__number">#{choice.pull.number}</span>
          <PullStateChip state={choice.pull.state} />
          <span className="pull-bar__title">{choice.pull.title}</span>
        </button>
      )}
      <div className={`panes panes--${choice.phase}`}>
        {choice.phase === "reviewing" && (
          <button
            type="button"
            aria-label="show the pull request list"
            onClick={onOpen}
            className="pull-rail"
          >
            pull requests
          </button>
        )}
        <div className="pane pane--list">
          {choice.phase === "picking" && (
            <header className="pull-sheet__header">
              <span className="pull-sheet__caption">pull requests</span>
              <button
                type="button"
                onClick={onDismiss}
                className="pull-sheet__close"
              >
                close
              </button>
            </header>
          )}
          {list}
        </div>
        <div className="pane pane--main">{review}</div>
      </div>
      {choice.phase === "picking" && (
        <button
          type="button"
          aria-label="dismiss the pull request list"
          onClick={onDismiss}
          className="pull-scrim"
        />
      )}
    </>
  );
}
// ~/~ end
