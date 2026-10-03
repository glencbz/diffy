// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-panes>>[init]
import type { ReactNode } from "react";
import type { PullChoice } from "../../model/place";
import type { PullSummary } from "../../model/pull";
import { PullStateChip } from "../PullStateChip";
import { PullList } from "./PullList";

export function PullPanes({
  choice,
  onOpen,
  onDismiss,
  pulls,
  onSelect,
  review,
}: {
  choice: PullChoice;
  onOpen: () => void;
  onDismiss: () => void;
  pulls: PullSummary[];
  onSelect: (number: number) => void;
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
          <PullList
            pulls={pulls}
            selected={choice.phase === "browsing" ? null : choice.pull.number}
            onSelect={onSelect}
          />
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
