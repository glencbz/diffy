// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-review-panes>>[init]
import type { ReactNode } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSize, Splitter } from "./Splitter";

export type Pane = "before" | "after" | "diff";

/** What each pane is called. Without an interdiff the after side is the
 *  only graph, and "after" would name a comparison nobody asked for. */
function caption(pane: Pane, interdiff: boolean): string {
  if (pane === "after" && !interdiff) return "commits";
  return pane;
}

export function ReviewPanes({
  before,
  after,
  diff,
  interdiff,
  showing,
  onShow,
  selected,
  sizes,
  onResize,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
  /** Whether the before side is open beside the after side. */
  interdiff: boolean;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
  sizes: PaneSizes;
  onResize: (pane: PaneKey, size: number | null) => void;
}) {
  const panes: Pane[] = interdiff
    ? ["before", "after", "diff"]
    : ["after", "diff"];
  const current = panes.includes(showing) ? showing : "after";
  const afterKey: PaneKey = interdiff ? "local-after" : "local-log";

  return (
    <>
      <PaneTabs
        panes={panes}
        interdiff={interdiff}
        showing={current}
        onShow={onShow}
        selected={selected}
      />
      <div className="panes panes--review">
        {interdiff && (
          <PickerColumn
            pane="before"
            caption={caption("before", interdiff)}
            showing={current}
            sizeKey="local-before"
            size={sizes["local-before"] ?? null}
            onResize={(size) => onResize("local-before", size)}
          >
            {before}
          </PickerColumn>
        )}
        <PickerColumn
          pane="after"
          caption={caption("after", interdiff)}
          showing={current}
          sizeKey={afterKey}
          size={sizes[afterKey] ?? null}
          onResize={(size) => onResize(afterKey, size)}
        >
          {after}
        </PickerColumn>
        <div className={paneClass("pane pane--diff", current === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  panes,
  interdiff,
  showing,
  onShow,
  selected,
}: {
  panes: Pane[];
  interdiff: boolean;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <nav className="pane-tabs">
      {panes.map((pane) => (
        <button
          type="button"
          key={pane}
          onClick={() => onShow(pane)}
          className={
            pane === showing ? "pane-tab pane-tab--current" : "pane-tab"
          }
          aria-current={pane === showing}
        >
          <span className="pane-tab__caption">{caption(pane, interdiff)}</span>
          {pane !== "diff" && (
            <span className="pane-tab__picked">{picked(selected[pane])}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

function picked(commits: number): string {
  if (commits === 0) return "nothing yet";
  return commits === 1 ? "1 commit" : `${commits} commits`;
}

function PickerColumn({
  pane,
  caption,
  showing,
  sizeKey,
  size,
  onResize,
  children,
}: {
  pane: "before" | "after";
  caption: string;
  showing: Pane;
  sizeKey: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  children: ReactNode;
}) {
  const width = sizeKey === "local-log" ? "pane--log" : "pane--picker";
  const sized = size === null ? `pane ${width}` : `pane ${width} pane--sized`;
  return (
    <>
      <div
        className={paneClass(sized, pane === showing)}
        style={paneSize(size)}
      >
        <h2 className="pane__header">{caption}</h2>
        <div className="pane__body">{children}</div>
      </div>
      <Splitter
        pane={sizeKey}
        size={size}
        onResize={onResize}
        label={`resize the ${caption} column`}
      />
    </>
  );
}

function paneClass(pane: string, showing: boolean): string {
  return showing ? `${pane} pane--showing` : pane;
}
// ~/~ end
