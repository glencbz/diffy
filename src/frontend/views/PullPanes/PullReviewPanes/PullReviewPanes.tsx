// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-review-panes>>[init]
import { type ReactNode, useState } from "react";
import { paneSize, Splitter } from "../../Splitter";
import { DrawerBar } from "./DrawerBar";

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
// ~/~ end
