// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-review-panes>>[init]
import type { ReactNode } from "react";

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
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
  showing: Pane;
  onShow: (pane: Pane) => void;
  selected: Record<"before" | "after", number>;
}) {
  return (
    <>
      <PaneTabs showing={showing} onShow={onShow} selected={selected} />
      <div className="panes panes--review">
        <PickerColumn pane="before" showing={showing}>
          {before}
        </PickerColumn>
        <PickerColumn pane="after" showing={showing}>
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
  children,
}: {
  pane: "before" | "after";
  showing: Pane;
  children: ReactNode;
}) {
  return (
    <div className={paneClass("pane pane--picker", pane === showing)}>
      <h2 className="pane__header">{CAPTIONS[pane]}</h2>
      <div className="pane__body">{children}</div>
    </div>
  );
}

function paneClass(pane: string, showing: boolean): string {
  return showing ? `${pane} pane--showing` : pane;
}
// ~/~ end
