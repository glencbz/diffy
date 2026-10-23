// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-model-panels>>[init]
import * as z from "zod";

export const PanelId = z.enum(["code", "commits", "threads", "components"]);
export type PanelId = z.infer<typeof PanelId>;

export const PANEL_NAMES: Record<PanelId, string> = {
  code: "Code",
  commits: "Commits",
  threads: "Threads",
  components: "Components",
};

export interface Leaf {
  kind: "leaf";
  id: string;
  tabs: PanelId[];
  active: PanelId;
}

export interface Split {
  kind: "split";
  id: string;
  dir: "row" | "column";
  /** Each child's share of the room, or null for its natural size. */
  sizes: (number | null)[];
  children: Tile[];
}

export type Tile = Leaf | Split;

const LeafSchema = z.object({
  kind: z.literal("leaf"),
  id: z.string(),
  tabs: z.array(PanelId).min(1),
  active: PanelId,
});

export const Tile: z.ZodType<Tile> = z.lazy(() =>
  z.union([
    LeafSchema,
    z.object({
      kind: z.literal("split"),
      id: z.string(),
      dir: z.enum(["row", "column"]),
      sizes: z.array(z.number().positive().nullable()),
      children: z.array(Tile).min(2),
    }),
  ]),
);

export interface Layout {
  id: string;
  name: string;
  tree: Tile;
}

const leaf = (id: string, tabs: PanelId[]): Leaf => ({
  kind: "leaf",
  id,
  tabs,
  active: tabs[0] as PanelId,
});

const split = (
  id: string,
  dir: Split["dir"],
  children: Tile[],
  sizes: (number | null)[],
): Split => ({ kind: "split", id, dir, sizes, children });

export const LAYOUTS: Layout[] = [
  {
    id: "stacked",
    name: "Stacked",
    tree: split(
      "stacked",
      "column",
      [
        leaf("stacked/drawer", ["commits", "threads"]),
        split(
          "stacked/main",
          "row",
          [
            leaf("stacked/rail", ["components"]),
            leaf("stacked/code", ["code"]),
          ],
          [null, 1],
        ),
      ],
      [null, 1],
    ),
  },
  {
    id: "columns",
    name: "Columns",
    tree: split(
      "columns",
      "row",
      [
        leaf("columns/list", ["commits", "threads"]),
        leaf("columns/rail", ["components"]),
        leaf("columns/code", ["code"]),
      ],
      [0.28, null, 0.72],
    ),
  },
  {
    id: "code",
    name: "Code first",
    tree: split(
      "code",
      "row",
      [
        leaf("code/code", ["code"]),
        leaf("code/side", ["components", "commits", "threads"]),
      ],
      [0.7, 0.3],
    ),
  },
];

/** The layouts the reader has, which one is in use, and their edits to
 *  each, kept on the server. */
export const LayoutsDocument = z.object({
  current: z.string(),
  edited: z.record(z.string(), Tile),
});
export type LayoutsDocument = z.infer<typeof LayoutsDocument>;

export const DEFAULT_LAYOUTS: LayoutsDocument = {
  current: "stacked",
  edited: {},
};

export function layoutOf(document: LayoutsDocument): Layout {
  return (
    LAYOUTS.find((each) => each.id === document.current) ??
    (LAYOUTS[0] as Layout)
  );
}

/** The tree a layout is drawn from: the reader's edit if it is whole, or
 *  the layout as it comes. */
export function treeOf(document: LayoutsDocument, layout: Layout): Tile {
  const edited = document.edited[layout.id];
  return edited !== undefined && isWhole(edited) ? edited : layout.tree;
}

export function leaves(tile: Tile): Leaf[] {
  return tile.kind === "leaf" ? [tile] : tile.children.flatMap(leaves);
}

export function panelsIn(tile: Tile): PanelId[] {
  return leaves(tile).flatMap((each) => each.tabs);
}

/** Whether a tree holds the code and names no panel twice. */
export function isWhole(tile: Tile): boolean {
  const panels = panelsIn(tile);
  return panels.includes("code") && new Set(panels).size === panels.length;
}

/** The panels a tree has closed, for the reader to add back. */
export function missing(tile: Tile): PanelId[] {
  const placed = panelsIn(tile);
  return PanelId.options.filter((each) => !placed.includes(each));
}

export function findLeaf(tile: Tile, id: string): Leaf | null {
  return leaves(tile).find((each) => each.id === id) ?? null;
}

export function leafWith(tile: Tile, panel: PanelId): Leaf | null {
  return leaves(tile).find((each) => each.tabs.includes(panel)) ?? null;
}

function mapLeaves(tile: Tile, change: (leaf: Leaf) => Leaf): Tile {
  if (tile.kind === "leaf") return change(tile);
  return {
    ...tile,
    children: tile.children.map((child) => mapLeaves(child, change)),
  };
}

export function setActive(tile: Tile, leafId: string, panel: PanelId): Tile {
  return mapLeaves(tile, (each) =>
    each.id === leafId && each.tabs.includes(panel)
      ? { ...each, active: panel }
      : each,
  );
}

export function setSizes(
  tile: Tile,
  splitId: string,
  sizes: (number | null)[],
): Tile {
  if (tile.kind === "leaf") return tile;
  if (tile.id === splitId) return { ...tile, sizes };
  return {
    ...tile,
    children: tile.children.map((child) => setSizes(child, splitId, sizes)),
  };
}

/** The tree without `panel`. A leaf it empties goes, and a split left one
 *  child gives way to it. The code never closes. */
export function closePanel(tile: Tile, panel: PanelId): Tile {
  if (panel === "code") return tile;
  return without(tile, panel) ?? tile;
}

function without(tile: Tile, panel: PanelId): Tile | null {
  if (tile.kind === "leaf") {
    const tabs = tile.tabs.filter((each) => each !== panel);
    if (tabs.length === 0) return null;
    return {
      ...tile,
      tabs,
      active: tabs.includes(tile.active) ? tile.active : (tabs[0] as PanelId),
    };
  }
  const kept = tile.children.flatMap((child, index) => {
    const next = without(child, panel);
    return next === null ? [] : [{ child: next, size: tile.sizes[index] ?? 1 }];
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return (kept[0] as { child: Tile }).child;
  return {
    ...tile,
    children: kept.map((each) => each.child),
    sizes: kept.map((each) => each.size),
  };
}

/** `panel` as a tab of the leaf `leafId`, in front, moved from wherever it
 *  was or added if it was closed. */
export function movePanel(tile: Tile, panel: PanelId, leafId: string): Tile {
  const target = findLeaf(tile, leafId);
  if (target === null) return tile;
  if (target.tabs.includes(panel)) return setActive(tile, leafId, panel);
  // A leaf whose only tab is moving goes with it, unless it is the target.
  const rest = without(tile, panel);
  if (rest === null || findLeaf(rest, leafId) === null) return tile;
  return mapLeaves(rest, (each) =>
    each.id === leafId
      ? { ...each, tabs: [...each.tabs, panel], active: panel }
      : each,
  );
}
// ~/~ end
