// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-review-panes>>[init]
import type { ReactNode } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSize, Splitter } from "./Splitter";

export type Pane = "before" | "after" | "diff";

const CAPTIONS: Record<Pane, string> = {
  before: "before",
  after: "after",
  diff: "diff",
};

export function ReviewPanes({
  before,
  after,
  diff,
  showing,
  onShow,
  selected,
  sizes,
  onResize,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
  sizes: PaneSizes;
  onResize: (pane: PaneKey, size: number | null) => void;
}) {
  return (
    <>
      <PaneTabs showing={showing} onShow={onShow} selected={selected} />
      <div className="panes panes--review">
        <PickerColumn
          pane="before"
          showing={showing}
          size={sizes["local-before"] ?? null}
          onResize={(size) => onResize("local-before", size)}
        >
          {before}
        </PickerColumn>
        <PickerColumn
          pane="after"
          showing={showing}
          size={sizes["local-after"] ?? null}
          onResize={(size) => onResize("local-after", size)}
        >
          {after}
        </PickerColumn>
        <div className={paneClass("pane pane--diff", showing === "diff")}>
          {diff}
        </div>
      </div>
    </>
  );
}

function PaneTabs({
  showing,
  onShow,
  selected,
}: {
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <nav className="pane-tabs">
      {(Object.keys(CAPTIONS) as Pane[]).map((pane) => (
        <button
          type="button"
          key={pane}
          onClick={() => onShow(pane)}
          className={
            pane === showing ? "pane-tab pane-tab--current" : "pane-tab"
          }
          aria-current={pane === showing}
        >
          <span className="pane-tab__caption">{CAPTIONS[pane]}</span>
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
  showing,
  size,
  onResize,
  children,
}: {
  pane: "before" | "after";
  showing: Pane;
  size: number | null;
  onResize: (size: number | null) => void;
  children: ReactNode;
}) {
  const sized =
    size === null ? "pane pane--picker" : "pane pane--picker pane--sized";
  return (
    <>
      <div
        className={paneClass(sized, pane === showing)}
        style={paneSize(size)}
      >
        <h2 className="pane__header">{CAPTIONS[pane]}</h2>
        <div className="pane__body">{children}</div>
      </div>
      <Splitter
        pane={pane === "before" ? "local-before" : "local-after"}
        size={size}
        onResize={onResize}
        label={`resize the ${CAPTIONS[pane]} column`}
      />
    </>
  );
}

function paneClass(pane: string, showing: boolean): string {
  return showing ? `${pane} pane--showing` : pane;
}
// ~/~ end
