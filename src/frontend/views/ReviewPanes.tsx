// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-review-panes>>[init]
import type { ReactNode } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSize, Splitter } from "./Splitter";

export type Pane = "before" | "after" | "combined" | "diff";

/** Which columns the screen draws: the lone graph, an interdiff on two
 *  graphs, or an interdiff on one. */
export type PaneLayout = "log" | "split" | "combined";

const PANES: Record<PaneLayout, Pane[]> = {
  log: ["after", "diff"],
  split: ["before", "after", "diff"],
  combined: ["combined", "diff"],
};

/** What each pane is called. A graph with no second graph beside it holds
 *  "commits"; "after" alone would name a comparison nobody asked for. */
function caption(pane: Pane, layout: PaneLayout): string {
  if (pane === "combined" || (pane === "after" && layout === "log")) {
    return "commits";
  }
  return pane;
}

export function ReviewPanes({
  before,
  after,
  combined,
  diff,
  layout,
  showing,
  onShow,
  selected,
  sizes,
  onResize,
}: {
  before: ReactNode;
  after: ReactNode;
  /** The one-graph interdiff's column, drawn only in that layout. */
  combined: ReactNode;
  diff: ReactNode;
  layout: PaneLayout;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
  sizes: PaneSizes;
  onResize: (pane: PaneKey, size: number | null) => void;
}) {
  const panes = PANES[layout];
  // A pane the layout lacks falls back to the graph beside the diff.
  const current = panes.includes(showing)
    ? showing
    : (panes[panes.length - 2] as Pane);
  const afterKey: PaneKey = layout === "log" ? "local-log" : "local-after";

  return (
    <>
      <PaneTabs
        panes={panes}
        layout={layout}
        showing={current}
        onShow={onShow}
        selected={selected}
      />
      <div className="panes panes--review">
        {layout === "split" && (
          <PickerColumn
            pane="before"
            caption={caption("before", layout)}
            showing={current}
            sizeKey="local-before"
            size={sizes["local-before"] ?? null}
            onResize={(size) => onResize("local-before", size)}
          >
            {before}
          </PickerColumn>
        )}
        {layout === "combined" ? (
          <PickerColumn
            pane="combined"
            caption={caption("combined", layout)}
            showing={current}
            sizeKey="local-combined"
            size={sizes["local-combined"] ?? null}
            onResize={(size) => onResize("local-combined", size)}
          >
            {combined}
          </PickerColumn>
        ) : (
          <PickerColumn
            pane="after"
            caption={caption("after", layout)}
            showing={current}
            sizeKey={afterKey}
            size={sizes[afterKey] ?? null}
            onResize={(size) => onResize(afterKey, size)}
          >
            {after}
          </PickerColumn>
        )}
        <div className={paneClass("pane pane--diff", current === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  panes,
  layout,
  showing,
  onShow,
  selected,
}: {
  panes: Pane[];
  layout: PaneLayout;
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
          <span className="pane-tab__caption">{caption(pane, layout)}</span>
          {pane !== "diff" && (
            <span className="pane-tab__picked">
              {pane === "combined"
                ? `before: ${picked(selected.before)}, after: ${picked(selected.after)}`
                : picked(selected[pane])}
            </span>
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
  pane: "before" | "after" | "combined";
  caption: string;
  showing: Pane;
  sizeKey: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  children: ReactNode;
}) {
  // A column beside another graph is narrow; a graph on its own is wide.
  const width =
    sizeKey === "local-before" || sizeKey === "local-after"
      ? "pane--picker"
      : "pane--log";
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
