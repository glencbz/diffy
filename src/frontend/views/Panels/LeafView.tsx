// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-view-panels-leaf>>[init]
import { useState } from "react";
import {
  closePanel,
  type Leaf,
  movePanel,
  PANEL_NAMES,
  type PanelId,
  type Tile,
} from "../../model/panels";
import { Host } from "./Host";

export function LeafView({
  leaf,
  tree,
  axis,
  hosts,
  badges,
  focused,
  folded,
  dragging,
  onFocus,
  onShow,
  onFold,
  onZoom,
  onDrag,
  onArrange,
}: {
  leaf: Leaf;
  tree: Tile;
  /** Which way the split holding it lays its children. */
  axis: "row" | "column";
  hosts: ReadonlyMap<PanelId, HTMLElement>;
  badges: Partial<Record<PanelId, string>>;
  focused: boolean;
  folded: boolean;
  dragging: PanelId | null;
  onFocus: () => void;
  onShow: (panel: PanelId) => void;
  onFold: (fold: boolean) => void;
  onZoom: () => void;
  onDrag: (panel: PanelId | null) => void;
  onArrange: (tree: Tile) => void;
}) {
  const [over, setOver] = useState(false);
  const takes = dragging !== null && !leaf.tabs.includes(dragging);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target, and a click anywhere in it focuses it
    <section
      className={`panel-leaf panel-leaf--${axis}${focused ? " panel-leaf--focused" : ""}${folded ? " panel-leaf--folded" : ""}${over ? " panel-leaf--over" : ""}`}
      onPointerDownCapture={onFocus}
      onDragOver={(event) => {
        if (!takes) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (dragging !== null && takes) {
          onArrange(movePanel(tree, dragging, leaf.id));
        }
        onDrag(null);
      }}
    >
      <div className="panel-tabs" role="tablist">
        {leaf.tabs.map((panel) => (
          <span key={panel} className="panel-tab">
            <button
              type="button"
              role="tab"
              aria-selected={!folded && panel === leaf.active}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", PANEL_NAMES[panel]);
                event.dataTransfer.effectAllowed = "move";
                onDrag(panel);
              }}
              onDragEnd={() => onDrag(null)}
              onClick={() => onShow(panel)}
              className="panel-tab__name"
            >
              {PANEL_NAMES[panel]}
              {badges[panel] !== undefined && (
                <span className="panel-tab__badge">{badges[panel]}</span>
              )}
            </button>
            {panel !== "code" && panel === leaf.active && !folded && (
              <button
                type="button"
                className="panel-tab__close"
                aria-label={`close ${PANEL_NAMES[panel]}`}
                onClick={() => onArrange(closePanel(tree, panel))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!folded && (
          <span className="panel-tabs__end">
            <button
              type="button"
              className="panel-tabs__act"
              title="fold to its tabs"
              onClick={() => onFold(true)}
            >
              fold
            </button>
            <button
              type="button"
              className="panel-tabs__act"
              title="zoom (z, or hold z to peek)"
              onClick={onZoom}
            >
              zoom
            </button>
          </span>
        )}
      </div>
      {!folded && <Host host={hosts.get(leaf.active) as HTMLElement} />}
    </section>
  );
}
// ~/~ end
