// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-review-panes>>[init]
import { type ReactNode, useState } from "react";
import { paneSize, Splitter } from "../Splitter";
import { DrawerBar } from "./DrawerBar";
import { type DrawerTab, DrawerTabs } from "./DrawerTabs";

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
  threads,
  openThreads,
  diff,
  position,
  onStep,
  size,
  onResize,
}: {
  /** The series screen's header, which a pull request and a local review
   *  each fill in for themselves. */
  header: ReactNode;
  picker: ReactNode;
  commits: ReactNode;
  threads: ReactNode;
  /** How many threads the series has open, for the tab to say. */
  openThreads: number;
  diff: ReactNode;
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
  size: number | null;
  onResize: (size: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<DrawerTab>("commits");
  return (
    <>
      {header}
      <div className="pull-toolbar">{picker}</div>
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
              <DrawerTabs tab={tab} onTab={setTab} openThreads={openThreads} />
              {tab === "commits" ? commits : threads}
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
// ~/~ end
