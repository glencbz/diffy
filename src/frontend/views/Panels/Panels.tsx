// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-view-panels>>[init]
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Leaf,
  leaves,
  missing,
  movePanel,
  PANEL_NAMES,
  PanelId,
  setActive,
  type Tile,
} from "../../model/panels";
import { Host } from "./Host";
import { LeafView } from "./LeafView";
import { SplitView } from "./SplitView";

/** How long `z` is held before it was a peek rather than a press. */
const PEEK_MS = 350;

const typing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export function Panels({
  tree,
  layouts,
  layout,
  onChoose,
  onArrange,
  onUndo,
  onReset,
  bodies,
  empty,
  badges,
  tools,
  bar,
}: {
  tree: Tile;
  layouts: { id: string; name: string }[];
  layout: string;
  onChoose: (id: string) => void;
  onArrange: (tree: Tile) => void;
  onUndo: (() => void) | null;
  onReset: (() => void) | null;
  bodies: Record<PanelId, ReactNode>;
  /** The panels with nothing to show for this commit. */
  empty: ReadonlySet<PanelId>;
  badges: Partial<Record<PanelId, string>>;
  /** Controls a panel puts in its leaf's tab bar while it is in front. */
  tools: Partial<Record<PanelId, ReactNode>>;
  /** What the bar holds at its left. */
  bar: ReactNode;
}) {
  const [hosts] = useState(() => {
    const out = new Map<PanelId, HTMLElement>();
    for (const id of PanelId.options) {
      const host = document.createElement("div");
      host.className = `panel-host panel-host--${id}`;
      out.set(id, host);
    }
    return out;
  });
  const [front, setFront] = useState<ReadonlyMap<string, PanelId>>(new Map());
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [zoom, setZoom] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const narrow = useNarrow();

  const shown = [...front].reduce(
    (now, [leafId, panel]) => setActive(now, leafId, panel),
    tree,
  );
  const all = leaves(shown);
  const focusedLeaf =
    all.find((each) => each.id === focused) ??
    all.find((each) => each.tabs.includes("code"));
  const folded = (leaf: Leaf) =>
    folds.get(leaf.id) ?? leaf.tabs.every((panel) => empty.has(panel));
  const zoomed = all.find((each) => each.id === zoom) ?? null;

  const show = (leafId: string, panel: PanelId) => {
    setFront((now) => new Map(now).set(leafId, panel));
    setFolds((now) => new Map(now).set(leafId, false));
  };

  const latest = useRef({ layouts, onChoose, onUndo, zoom, focusedLeaf, all });
  latest.current = { layouts, onChoose, onUndo, zoom, focusedLeaf, all };
  useEffect(() => {
    let pressed = 0;
    const onDown = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey) return;
      if (event.altKey || event.repeat) return;
      const now = latest.current;
      const chosen = now.layouts[Number(event.key) - 1];
      if (chosen !== undefined) {
        now.onChoose(chosen.id);
        setZoom(null);
      } else if (event.key === "z") {
        pressed = Date.now();
        setZoom(now.zoom === null ? (now.focusedLeaf?.id ?? null) : null);
      } else if (event.key === "f") {
        const at = now.all.findIndex((each) => each.id === now.focusedLeaf?.id);
        const next = now.all[(at + 1) % now.all.length];
        if (next === undefined) return;
        setFocused(next.id);
        if (now.zoom !== null) setZoom(next.id);
      } else if (event.key === "u") {
        now.onUndo?.();
      } else if (event.key === "Escape" && now.zoom !== null) {
        setZoom(null);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key !== "z") return;
      if (pressed !== 0 && Date.now() - pressed > PEEK_MS) setZoom(null);
      pressed = 0;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const draw = (tile: Tile, axis: "row" | "column"): ReactNode => {
    if (tile.kind === "split") {
      return (
        <SplitView
          key={tile.id}
          split={tile}
          dir={narrow ? "column" : tile.dir}
          folded={tile.children.map(
            (child) => child.kind === "leaf" && folded(child),
          )}
          onSizes={(sizes) => onArrange(resized(tree, tile.id, sizes))}
        >
          {tile.children.map((child) =>
            draw(child, narrow ? "column" : tile.dir),
          )}
        </SplitView>
      );
    }
    return (
      <LeafView
        key={tile.id}
        leaf={tile}
        tree={tree}
        axis={axis}
        hosts={hosts}
        badges={badges}
        tools={folded(tile) ? null : (tools[tile.active] ?? null)}
        focused={tile.id === focusedLeaf?.id}
        folded={folded(tile)}
        dragging={dragging}
        onFocus={() => setFocused(tile.id)}
        onShow={(panel) => show(tile.id, panel)}
        onFold={(fold) => setFolds((now) => new Map(now).set(tile.id, fold))}
        onZoom={() => setZoom(tile.id)}
        onDrag={setDragging}
        onArrange={onArrange}
      />
    );
  };

  return (
    <div className="panels">
      {PanelId.options.map((id) =>
        createPortal(bodies[id], hosts.get(id) as HTMLElement, id),
      )}
      <div className="panels-bar">
        <div className="panels-bar__start">{bar}</div>
        <div
          className="panels-bar__layouts"
          role="tablist"
          aria-label="layouts"
        >
          {layouts.map((each, index) => (
            <button
              key={each.id}
              type="button"
              role="tab"
              aria-selected={each.id === layout}
              title={`${each.name} (${index + 1})`}
              onClick={() => {
                onChoose(each.id);
                setZoom(null);
              }}
              className="panels-bar__layout"
            >
              <kbd>{index + 1}</kbd> {each.name}
            </button>
          ))}
          <button
            type="button"
            className="panels-bar__act"
            title="undo the last change to the panels (u)"
            disabled={onUndo === null}
            onClick={() => onUndo?.()}
          >
            undo
          </button>
          {onReset !== null && (
            <button
              type="button"
              className="panels-bar__act"
              title="put this layout back as it comes"
              onClick={onReset}
            >
              reset
            </button>
          )}
        </div>
        {missing(tree).length > 0 && (
          <div className="panels-bar__closed">
            <span className="panels-bar__label">closed</span>
            {missing(tree).map((panel) => (
              <button
                key={panel}
                type="button"
                draggable
                title={`open ${PANEL_NAMES[panel]} in the focused panel, or drag it to one`}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", PANEL_NAMES[panel]);
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(panel);
                }}
                onDragEnd={() => setDragging(null)}
                onClick={() => {
                  if (focusedLeaf === undefined) return;
                  onArrange(movePanel(tree, panel, focusedLeaf.id));
                  show(focusedLeaf.id, panel);
                }}
                className="panels-bar__reopen"
              >
                + {PANEL_NAMES[panel]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="panels-tiles">
        {zoomed !== null ? (
          <div className="panels-zoom">
            <div className="panels-zoom__bar">
              <div className="panels-zoom__start">{bar}</div>
              {all.flatMap((each) =>
                each.tabs.map((panel) => (
                  <button
                    key={panel}
                    type="button"
                    aria-pressed={
                      each.id === zoomed.id && each.active === panel
                    }
                    onClick={() => {
                      show(each.id, panel);
                      setZoom(each.id);
                    }}
                    className="panels-zoom__panel"
                  >
                    {PANEL_NAMES[panel]}
                  </button>
                )),
              )}
              {tools[zoomed.active]}
              <button
                type="button"
                className="panels-bar__act panels-zoom__back"
                onClick={() => setZoom(null)}
              >
                back to the layout <kbd>z</kbd>
              </button>
            </div>
            <Host host={hosts.get(zoomed.active) as HTMLElement} />
          </div>
        ) : (
          draw(shown, "column")
        )}
      </div>
    </div>
  );
}

/** A drag sets sizes on the split as the screen shows it, whose tabs in
 *  front may differ from the tree's; only the sizes go back. */
function resized(tree: Tile, splitId: string, sizes: (number | null)[]): Tile {
  if (tree.kind === "leaf") return tree;
  if (tree.id === splitId) return { ...tree, sizes };
  return {
    ...tree,
    children: tree.children.map((child) => resized(child, splitId, sizes)),
  };
}

function useNarrow(): boolean {
  const query = "(max-width: 1000px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
// ~/~ end
