// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-state-panels>>[init]
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_LAYOUTS,
  LAYOUTS,
  type Layout,
  type LayoutsDocument,
  layoutOf,
  type Tile,
  treeOf,
} from "../model/panels";
import { layoutsStore } from "../persistence/layouts";

export interface PanelLayouts {
  layouts: Layout[];
  layout: Layout;
  tree: Tile;
  /** Whether the reader has changed this layout from how it comes. */
  edited: boolean;
  choose: (id: string) => void;
  arrange: (tree: Tile) => void;
  /** Null when there is nothing to undo. */
  undo: (() => void) | null;
  /** Null when the layout is as it comes. */
  reset: (() => void) | null;
}

const UNDO_DEPTH = 50;

export function usePanelLayouts(): PanelLayouts {
  const [document, setDocument] = useState<LayoutsDocument>(DEFAULT_LAYOUTS);
  const [past, setPast] = useState<LayoutsDocument[]>([]);
  const moved = useRef(false);
  useEffect(() => {
    let live = true;
    layoutsStore
      .load()
      .then((loaded) => {
        if (live && !moved.current) setDocument(loaded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const commit = (next: LayoutsDocument) => {
    moved.current = true;
    setPast((now) => [...now.slice(1 - UNDO_DEPTH), document]);
    setDocument(next);
    layoutsStore.save(next).catch(() => {});
  };
  const layout = layoutOf(document);
  const edited = document.edited[layout.id] !== undefined;
  return {
    layouts: LAYOUTS,
    layout,
    tree: treeOf(document, layout),
    edited,
    choose: (id) => {
      if (id !== layout.id) commit({ ...document, current: id });
    },
    arrange: (tree) =>
      commit({
        ...document,
        edited: { ...document.edited, [layout.id]: tree },
      }),
    undo:
      past.length === 0
        ? null
        : () => {
            const previous = past[past.length - 1] as LayoutsDocument;
            setPast((now) => now.slice(0, -1));
            setDocument(previous);
            layoutsStore.save(previous).catch(() => {});
          },
    reset: edited
      ? () => {
          const { [layout.id]: _, ...rest } = document.edited;
          commit({ ...document, edited: rest });
        }
      : null,
  };
}
// ~/~ end
