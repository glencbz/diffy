// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-panes>>[init]
import { type ReactNode, useState } from "react";
import type { PullSummary } from "../model/pull";
import { PullStateChip } from "./PullStateChip";
import { paneSize, Splitter } from "./Splitter";

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

/** Where the reader is in the stack: the row picked, if any, out of how
 *  many, and a line naming it. */
export interface StackPosition {
  index: number | null;
  count: number;
  summary: string;
}

export function PullReviewPanes({
  header,
  picker,
  commits,
  diff,
  position,
  onStep,
  size,
  onResize,
}: {
  header: ReactNode;
  picker: ReactNode;
  commits: ReactNode;
  diff: ReactNode;
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
  size: number | null;
  onResize: (size: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {header}
      {picker}
      <div className="panes panes--drawer">
        <DrawerBar
          position={position}
          onStep={onStep}
          open={open}
          onToggle={() => setOpen((now) => !now)}
        />
        {open && (
          <>
            <div
              className={
                size === null
                  ? "pane pane--commits"
                  : "pane pane--commits pane--sized"
              }
              style={paneSize(size)}
            >
              {commits}
            </div>
            <Splitter
              pane="pull-commits"
              size={size}
              onResize={onResize}
              label="resize the commit list"
            />
          </>
        )}
        <div className="pane pane--diff">{diff}</div>
      </div>
    </>
  );
}

function DrawerBar({
  position: { index, count, summary },
  onStep,
  open,
  onToggle,
}: {
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
  open: boolean;
  onToggle: () => void;
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
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="drawer-bar__toggle"
      >
        <span className="drawer-bar__position">
          {index === null ? commitCount(count) : `${index + 1} of ${count}`}
        </span>
        <span className="drawer-bar__summary">{summary}</span>
        <span className="drawer-bar__fold">
          {open ? "▾ fold" : "▸ show all"}
        </span>
      </button>
    </div>
  );
}

function commitCount(count: number): string {
  return count === 1 ? "1 commit" : `${count} commits`;
}
// ~/~ end
