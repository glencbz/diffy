# Panels

How a series review lays out what the reader looks at beside the code, and
the addresses that let one part of the screen follow another. The commits,
the threads, the component rail, the code and the [viewer](viewer.md) of
the author's captures are panels today; the [roadmap](#roadmap) adds runs.

A new kind of panel takes three steps: an id in `PanelId`, a body from the
screen's controller, and a rule for when it has nothing to show. When it
can show a new kind of thing, that thing gets a [location](#locations) and a
way to and from a component.

## Principles

Every choice below is judged against these, and they outlive any one layout.

1. **The code is home.** Reading code is the main job. Everything else is a
   glance away and brings the reader back to their place; nothing reloads,
   moves or hides the code behind their back.
2. **One focus, named once.** There is one thing in focus, the place being
   read and what was picked for it, named in one place. Panels show facets
   of it without saying again what it is.
3. **Fewer kinds of thing.** When two parts overlap, merge them rather than
   add a control to link them, and never repeat what the code already shows.
4. **Space follows attention.** A panel takes room only while it has
   something to say. Sizes change when the reader moves to another commit or
   asks, never because they picked something, so the screen holds still
   under their hand.
5. **Arrangements are cheap to change and cheap to undo.** A few layouts,
   one step to switch, the reader's edits to each kept, every change undone.
6. **Every frequent move has a key.** The mouse is for finding a move; keys
   are for making it again.

## Locations

A location is any spot in a review that a panel can show or point at. The
[address](address.md) already names the deliberate ones, down to a file's
line; a location covers the transient ones too, such as the component under
the reading line, and grows a kind for each new thing a panel can show.

Each kind carries the commit it belongs to, and every id in it is one the
[component map](components.md#the-component-map) keeps across versions. So a
location read at one version can be looked up again at the next, and a
panel that cannot find it says the thing is gone rather than going blank.

```ts
//| id: frontend-model-location
//| file: src/frontend/model/location.ts
import type { Component } from "./components";

/** A spot in a review that a panel can show or point at. */
export type Location = CodeLocation | ComponentLocation;

/** A line of a file, on one side of a commit's diff. */
export interface CodeLocation {
  kind: "code";
  commit: string;
  path: string;
  side: "before" | "after";
  line: number;
}

/** A component, and the file it is being read in when it spans several. */
export interface ComponentLocation {
  kind: "component";
  commit: string;
  component: string;
  path: string | null;
}

export type LocationKind = Location["kind"];

/** A place a panel asked the code to go, numbered so the same place asked
 *  twice still moves it. */
export interface Asked {
  location: Location;
  at: number;
}

export function sameLocation(a: Location | null, b: Location | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "code" && b.kind === "code") {
    return (
      a.commit === b.commit &&
      a.path === b.path &&
      a.side === b.side &&
      a.line === b.line
    );
  }
  if (a.kind === "component" && b.kind === "component") {
    return (
      a.commit === b.commit && a.component === b.component && a.path === b.path
    );
  }
  return false;
}
```

### Resolving one kind into another

Most of what looks like panels keeping in step is translation: given where
the reader is, what should another panel show? The component is the hub
every kind maps through, since the map already ties each component to its
lines and will tie it to the captures that show it and the steps that run
it. Each kind therefore needs only a way to and from a component, not a way
to every other kind.

The links are many to many, so resolving answers a ranked list: a panel
shows the first and can offer the rest. A code line inside two components'
places, one nested in the other, answers the narrower first.

```ts
//| id: frontend-model-location

/** The components a location is in, the most specific first. */
export function componentsAt(
  location: Location,
  components: Component[],
): Component[] {
  if (location.kind === "component") {
    return components.filter(
      (each) =>
        each.id === location.component && each.commitId === location.commit,
    );
  }
  const covering = components.flatMap((component) => {
    if (component.commitId !== location.commit) return [];
    const spans = component.places
      .filter(
        (place) =>
          place.path === location.path &&
          place.side === location.side &&
          place.start <= location.line &&
          (place.end ?? place.start) >= location.line,
      )
      .map((place) => (place.end ?? place.start) - place.start);
    return spans.length === 0 ? [] : [{ component, span: Math.min(...spans) }];
  });
  return covering.sort((a, b) => a.span - b.span).map((each) => each.component);
}

/** Where a location's code is: its own line, or the first line of each of
 *  a component's places, in the map's order, the file being read first. */
export function codeAt(
  location: Location,
  components: Component[],
): CodeLocation[] {
  if (location.kind === "code") return [location];
  const component = componentsAt(location, components)[0];
  if (component === undefined) return [];
  const lines = component.places.map(
    (place): CodeLocation => ({
      kind: "code",
      commit: component.commitId,
      path: place.path,
      side: place.side,
      line: place.start,
    }),
  );
  return [
    ...lines.filter((line) => line.path === location.path),
    ...lines.filter((line) => line.path !== location.path),
  ];
}
```

## The focus

The focus is where the reader is, held above the views so that any panel
can follow it. The components view moves it as the reading line passes each
heading; a panel added later reads it to pick what to show, and never writes
it back, so two panels can never chase each other. The deliberate moves, a
commit picked or a line linked, stay in the [address](address.md), where a
reload and a shared link find them; the focus is only what scrolling
changes, which would fill the browser's history if it went there too.

A follower that wants the code somewhere else asks rather than writes: the
request goes to the components view, which owns the code's scroll, and the
reading changes only when the code gets there. So the reading always says
what the code shows, never what a panel hoped it would.

```ts
//| id: frontend-state-focus
//| file: src/frontend/state/focus.ts
import { useCallback, useState } from "react";
import { type Asked, type Location, sameLocation } from "../model/location";

export interface Focus {
  /** What the reading line is over, or null above the first heading. */
  reading: Location | null;
  onRead: (next: Location | null) => void;
  /** The last place a follower asked the code to go. */
  asked: Asked | null;
  ask: (location: Location) => void;
}

export function useFocus(): Focus {
  const [reading, setReading] = useState<Location | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const ask = useCallback(
    (location: Location) =>
      setAsked((now) => ({ location, at: (now?.at ?? 0) + 1 })),
    [],
  );
  // The reading line reports on every frame of a scroll; only a change
  // draws anything again.
  const onRead = useCallback(
    (next: Location | null) =>
      setReading((now) => (sameLocation(now, next) ? now : next)),
    [],
  );
  return { reading, onRead, asked, ask };
}
```

## The layout tree

A layout is a tree: splits lay their children side by side or stacked, and
each leaf holds panels as tabs, one in front. A grid of fixed regions would
be simpler, but every arrangement the reader wants would need a region
built for it; a tree takes any of them from the same few moves.

A split's sizes are shares of the room left over, and a null share is the
child's natural size: the commits as tall as their rows, the components as
wide as their names. A natural size stops at `--panel-natural-height` in a
column and `--panel-natural-width` in a row, so a long list never pushes
the code off the screen; a fixed share instead would leave an empty band
under a short stack, which is most pull requests. The default layouts lean on that so they lie the
way the screen always has, and a drag turns every share in the split into a
measured one.

The moves never make an id, since a tab only ever goes to a leaf that
exists, so a layout's ids are the ones it was written with and the reader's
edits can be told apart from it. A tree that has lost the code, or names a
panel twice, is no layout, and the one it was made from stands in for it.

```ts
//| id: frontend-model-panels
//| file: src/frontend/model/panels.ts
import * as z from "zod";

export const PanelId = z.enum([
  "code",
  "commits",
  "threads",
  "components",
  "viewer",
]);
export type PanelId = z.infer<typeof PanelId>;

export const PANEL_NAMES: Record<PanelId, string> = {
  code: "Code",
  commits: "Commits",
  threads: "Threads",
  components: "Components",
  viewer: "Viewer",
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
            leaf("stacked/viewer", ["viewer"]),
          ],
          [null, 0.62, 0.38],
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
        leaf("columns/list", ["commits", "threads", "viewer"]),
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
        leaf("code/side", ["components", "viewer", "commits", "threads"]),
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
```

## Keeping layouts

The layouts are the reader's and live on the
[server](../backend/layouts.md), so a second browser opens the screen the
way the first left it. The screen starts on the defaults and takes the
server's document when it arrives, unless the reader has already moved
something.

```ts
//| id: frontend-persistence-layouts
//| file: src/frontend/persistence/layouts.ts
import { LayoutsDocument } from "../model/panels";

export const layoutsStore = {
  async load(): Promise<LayoutsDocument> {
    const res = await fetch("/api/layouts");
    if (!res.ok) throw new Error(`the layout store answered ${res.status}`);
    return LayoutsDocument.parse(await res.json());
  },
  async save(document: LayoutsDocument): Promise<void> {
    const res = await fetch("/api/layouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    if (!res.ok) throw new Error(`the layout store answered ${res.status}`);
  },
};
```

Every arrangement the reader makes, switching layouts included, can be
undone; which tab is in front is not an arrangement, and stays with the
screen rather than the document. Undo lasts as long as the screen. A save
that fails keeps the screen as the reader left it, and the next one sends
the whole document again.

```ts
//| id: frontend-state-panels
//| file: src/frontend/state/panels.ts
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
```

## The panels view

`Panels` draws a tree with a bar over it: whatever the caller puts at the
bar's left, then the layouts as tabs, undo and reset. The caller hands it
every panel's body, which panels have nothing to show for the commit, and a
short badge per tab; it calls back with each new arrangement.

Each body is drawn once, into an element of its own that `Panels` keeps for
as long as it lives, and a leaf moves that element in when it shows the
panel. Drawing a body inside its leaf would be simpler, but a tab moved to
another leaf, a zoom or a switch of layout would draw the code again from
nothing, and the reader would lose their place in it.

The keys are the layouts' numbers, `z` to zoom the focused panel (held, a
peek that ends when it is let go), `f` to move the focus to the next panel
and `u` to undo. Which tab is in front of each leaf, which leaves the reader
folded, and what is zoomed belong to the screen, not the layout. A leaf
whose panels have nothing to show folds to its tabs until the reader opens
it.

A zoomed panel takes the whole window, over the screen's header and the
comparison toolbar as well as the other panels; on a phone those take a
third of the height, and a zoom that kept them would hardly be one. Its bar
keeps what the reader needs while reading: the stepper, a button for each
panel, the panel's own controls and the way back.

A panel's own controls, such as how the code is drawn, sit in its leaf's
tab bar while it is in front, beside fold and zoom, and in the zoom's bar
while it is zoomed. In a toolbar over the screen they would stay put when
the panel moved and stay lit when it closed, and the reader would have to
learn which panel each one belonged to.

A closed panel waits in the bar, named, as a button that opens it again in
the focused leaf; dragged, it goes to whichever leaf it is dropped on. A `+`
inside each leaf was the first try, but a faint glyph beside fold and zoom
read as one more control on that leaf rather than the way back to a panel
the reader had lost, and the bar is where the reader already goes to change
the arrangement.

Under 1000px every split stacks, since side by side nothing has room; the
leaves keep their order, so the commits still sit over the code. Stacked,
every leaf after the first that does not hold the code starts folded, or a
phone would give the code a sliver between them; each is a tap away, and
zoom gives any of them the screen.

```tsx
//| id: frontend-view-panels
//| file: src/frontend/views/Panels/Panels.tsx
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
    folds.get(leaf.id) ??
    (leaf.tabs.every((panel) => empty.has(panel)) ||
      (narrow && leaf.id !== all[0]?.id && !leaf.tabs.includes("code")));
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
```

### Host

An element moved out of the page forgets how far it was scrolled, so the
body's host keeps each scroll as it happens and puts it back once the host
lands in its next leaf. A leaf hands its host back when another tab comes
to the front, or the two bodies would share the leaf, each pushed down by
the other.

```tsx
//| id: frontend-view-panels-host
//| file: src/frontend/views/Panels/Host.tsx
import { useEffect, useRef } from "react";

const scrolls = new WeakMap<Element, number>();
const kept = new WeakSet<HTMLElement>();

export function Host({ host }: { host: HTMLElement }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current === null) return;
    if (!kept.has(host)) {
      kept.add(host);
      // Captured, since a scroll does not bubble.
      host.addEventListener(
        "scroll",
        (event) => {
          if (event.target instanceof Element && event.target.isConnected) {
            scrolls.set(event.target, event.target.scrollTop);
          }
        },
        { capture: true, passive: true },
      );
    }
    const into = box.current;
    into.appendChild(host);
    for (const element of [host, ...host.querySelectorAll("*")]) {
      const top = scrolls.get(element);
      if (top !== undefined && element.scrollTop !== top) {
        element.scrollTop = top;
      }
    }
    return () => {
      if (host.parentElement === into) into.removeChild(host);
    };
  }, [host]);
  return <div className="panel-body" ref={box} />;
}
```

### Split

A divider drag measures every child as drawn and sets all their sizes from
that, so a child at its natural size takes the share it had on screen.

```tsx
//| id: frontend-view-panels-split
//| file: src/frontend/views/Panels/SplitView.tsx
import { type ReactNode, useRef, useState } from "react";
import type { Split } from "../../model/panels";

/** What a drag always leaves either side of a divider, in pixels. */
const LEAST = 80;

export function SplitView({
  split,
  dir,
  folded,
  onSizes,
  children,
}: {
  split: Split;
  /** The split's own direction, or stacked on a narrow screen. */
  dir: Split["dir"];
  folded: boolean[];
  onSizes: (sizes: (number | null)[]) => void;
  children: ReactNode[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<(number | null)[] | null>(null);
  const sizes = live ?? split.sizes;
  const drag = (index: number) => (event: React.PointerEvent) => {
    const cells = [...(box.current?.children ?? [])] as HTMLElement[];
    if (cells.length !== children.length) return;
    event.preventDefault();
    const along = (rect: DOMRect) => (dir === "row" ? rect.width : rect.height);
    const from = cells.map((cell) => along(cell.getBoundingClientRect()));
    const start = dir === "row" ? event.clientX : event.clientY;
    let last: (number | null)[] = sizes;
    const move = (moved: PointerEvent) => {
      const by = (dir === "row" ? moved.clientX : moved.clientY) - start;
      const a = (from[index] ?? 0) + by;
      const b = (from[index + 1] ?? 0) - by;
      if (a < LEAST || b < LEAST) return;
      last = from.map((size, at) =>
        folded[at]
          ? (sizes[at] ?? null)
          : at === index
            ? a
            : at === index + 1
              ? b
              : size,
      );
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (last !== sizes) onSizes(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const natural = (index: number) =>
    (sizes[index] ?? null) === null || (folded[index] ?? false);
  // Flex hands out only the part of the room its grows add up to, so the
  // shares left once a child folds are scaled back up to the whole.
  const shared = sizes.reduce<number>(
    (sum, size, index) => (natural(index) ? sum : sum + (size ?? 0)),
    0,
  );
  return (
    <div ref={box} className={`panel-split panel-split--${dir}`}>
      {children.map((child, index) => {
        const size = sizes[index] ?? null;
        return (
          <div
            key={split.children[index]?.id}
            className={`panel-split__cell${natural(index) ? " panel-split__cell--natural" : ""}`}
            style={
              natural(index) || size === null
                ? undefined
                : { flex: `${size / shared} 1 0` }
            }
          >
            {child}
            {index < children.length - 1 &&
              !folded[index] &&
              !folded[index + 1] && (
                <div
                  className={`panel-split__handle panel-split__handle--${dir}`}
                  onPointerDown={drag(index)}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}
```

### Leaf

A leaf's tabs can be dragged onto another leaf and closed; the code's tab
does not close, since the code is home. A leaf folds to its tabs, standing
on end when it sits in a row.

```tsx
//| id: frontend-view-panels-leaf
//| file: src/frontend/views/Panels/LeafView.tsx
import { type ReactNode, useState } from "react";
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
  tools,
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
  /** The controls of the panel in front, beside fold and zoom. */
  tools: ReactNode;
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
            {tools}
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
```

### Styling

```css
/*| id: design-panels
@layer components {
  .panels {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .panels-bar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: stretch;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  /* Too narrow for both, the layouts wrap under the stepper rather than
     squeeze it. */
  .panels-bar__start {
    display: flex;
    flex: 1 1 20em;
    min-width: 0;
  }

  /* The stepper sits in the panels' bar, which draws the edge. */
  .panels-bar__start .stack-stepper,
  .panels-zoom__start .stack-stepper {
    flex: 1;
    border-bottom: none;
  }

  .panels-bar__layouts {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
    padding: 0 var(--space-4);
    font-size: var(--text-size-small);
  }

  .panels-bar__layout,
  .panels-bar__act {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .panels-bar__layout kbd,
  .panels-bar__act kbd {
    color: var(--text-faint);
    font-size: 0.85em;
  }

  .panels-bar__layout[aria-selected="true"] {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }

  .panels-bar__act {
    border-color: var(--border);
  }

  .panels-bar__act:disabled {
    color: var(--text-ghost);
    cursor: default;
  }

  /* A closed panel reads as a tab waiting to be put back. */
  .panels-bar__closed {
    display: flex;
    flex: none;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-size-small);
    border-left: 1px solid var(--border-subtle);
  }

  .panels-bar__label {
    color: var(--text-faint);
  }

  .panels-bar__reopen {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: grab;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }

  .panels-bar__reopen:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .panels-tiles {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .panel-split {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .panel-split--column {
    flex-direction: column;
  }

  .panel-split__cell {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .panel-split__cell--natural {
    flex: 0 1 auto;
  }

  .panel-split--column > .panel-split__cell--natural {
    max-height: var(--panel-natural-height);
  }

  .panel-split--row > .panel-split__cell--natural {
    max-width: var(--panel-natural-width);
  }

  .panel-split__handle {
    position: absolute;
    z-index: 3;
  }

  .panel-split__handle--row {
    top: 0;
    right: -3px;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
  }

  .panel-split__handle--column {
    right: 0;
    bottom: -3px;
    left: 0;
    height: 6px;
    cursor: row-resize;
  }

  .panel-split__handle:hover {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .panel-leaf {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .panel-leaf--over {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .panel-tabs {
    display: flex;
    flex: none;
    gap: var(--space-4);
    align-items: center;
    padding: 0 var(--space-4);
    font-size: var(--text-size-small);
    background: var(--surface);
    border-bottom: 1px solid var(--border-subtle);
  }

  .panel-leaf--focused > .panel-tabs {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .panel-tab {
    display: flex;
    align-items: center;
  }

  .panel-tab__name {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) 0;
    font: inherit;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
  }

  .panel-tab__name[aria-selected="true"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .panel-tab__badge {
    color: var(--review-open);
  }

  .panel-tab__close {
    padding: 0 var(--space-1);
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    background: none;
    border: none;
  }

  .panel-tabs__end {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
  }

  .panel-tabs__act {
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    background: none;
    border: none;
  }

  .panel-tabs__act:hover,
  .panel-tab__close:hover {
    color: var(--accent);
  }

  /* Folded in a row, a leaf's tabs stand on end. */
  .panel-leaf--folded.panel-leaf--row > .panel-tabs {
    flex: 1;
    flex-direction: column;
    padding: var(--space-4) 0;
    writing-mode: vertical-rl;
    border-bottom: none;
  }

  .panel-leaf--folded.panel-leaf--row .panel-tab__name {
    padding: 0 var(--space-2);
    border-bottom: none;
  }

  .panel-body,
  .panel-host {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .panel-host {
    overflow: auto;
  }

  /* The code scrolls in its own element inside the host, the one the
     commit stack and the components view read their place from. */
  .panel-host--code {
    overflow: hidden;
  }

  .code-panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .panels-zoom {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }

  .panels-zoom__start {
    display: flex;
    flex: 1 1 20em;
    min-width: 0;
  }

  .panels-zoom__bar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-size-small);
    background: var(--surface);
    border-bottom: 2px solid var(--accent);
  }

  .panels-zoom__panel {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .panels-zoom__panel[aria-pressed="true"] {
    color: var(--text);
    border-color: var(--border);
  }

  .panels-zoom__back {
    margin-left: auto;
  }
}
```

```css
/*| id: design-panels
@layer components-narrow {
  @media (max-width: 1000px) {
    .panels-bar__layout kbd,
    .panels-bar__act kbd {
      display: none;
    }

    .panel-tab__name,
    .panel-tabs__act,
    .panels-bar__reopen {
      min-height: 44px;
    }
  }
}
```

## Roadmap

What is still to build, in order. Each step is a pull request that moves its
part of this list into the sections above.

**Recording, for agents.** Agents attach captures with the
[evidence tools](../backend/evidence.md#the-tools); taking them is still
theirs to work out. They need:

- A recorder they can drive, as a skill: a Playwright script whose steps
  each take a screenshot and record the page's requests, console and the
  lines of the repository they ran, from V8 block coverage and CSS rule use,
  mapped back to source paths through source maps when the app is bundled.
- The same script run at the commit and at its parent, each served from its
  own jj workspace, so every step can be compared before and after.
- Boxes found from selectors, so an agent names the element a component
  draws rather than measuring pixels.

**Runs.** A run's steps are evidence of a second kind, attached with an
`attach_run` tool, and join the [viewer's](viewer.md) strip; Network and
Console show what the step in focus did, its requests answered before and
after. The lines a step ran are marked through the code's layer
(`StackLayer` and `LineDecor`), a class per step drawn once per commit, and
a rule picks out the step in focus, so moving the focus never draws the diff
again. The focus gains a hold, so the reader can keep a shot while reading
on.

**Comments on any location.** A box on a capture, a moment of a clip, a step
or a request can hold a thread, which needs an anchor in the review store
wider than a line.

## Tests

```ts
//| id: frontend-model-location-test
//| file: src/frontend/model/location.test.ts
import { describe, expect, test } from "bun:test";
import type { Component, ComponentPlace } from "./components";
import { codeAt, componentsAt, type Location, sameLocation } from "./location";

function component(
  id: string,
  places: Partial<ComponentPlace>[],
  commitId = "c1",
): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: places.map((place) => ({
      path: "a.ts",
      side: "after",
      start: 1,
      about: "",
      ...place,
    })),
  };
}

const line = (at: number, path = "a.ts"): Location => ({
  kind: "code",
  commit: "c1",
  path,
  side: "after",
  line: at,
});

describe("locations", () => {
  test("a line nested in two components is in the narrower first", () => {
    // arrange
    const outer = component("outer", [{ start: 1, end: 20 }]);
    const inner = component("inner", [{ start: 5, end: 8 }]);

    // act
    const found = componentsAt(line(6), [outer, inner]);

    // assert
    expect(found.map((each) => each.id)).toEqual(["inner", "outer"]);
  });

  test("a line on the other side or in another commit is in nothing", () => {
    // arrange
    const before = component("a", [{ side: "before", start: 1, end: 9 }]);
    const elsewhere = component("b", [{ start: 1, end: 9 }], "c2");

    // act
    const found = componentsAt(line(3), [before, elsewhere]);

    // assert
    expect(found).toEqual([]);
  });

  test("a component's code starts with the file being read", () => {
    // arrange
    const split = component("a", [
      { path: "a.ts", start: 4 },
      { path: "b.ts", start: 10 },
    ]);
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "b.ts",
    };

    // act
    const lines = codeAt(reading, [split]);

    // assert
    expect(lines.map((each) => `${each.path}:${each.line}`)).toEqual([
      "b.ts:10",
      "a.ts:4",
    ]);
  });

  test("locations of different kinds are never the same", () => {
    // arrange
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "a.ts",
    };

    // act
    const same = sameLocation(reading, line(1));

    // assert
    expect(same).toBe(false);
  });
});
```

```ts
//| id: frontend-model-panels-test
//| file: src/frontend/model/panels.test.ts
import { describe, expect, test } from "bun:test";
import {
  closePanel,
  DEFAULT_LAYOUTS,
  findLeaf,
  isWhole,
  LAYOUTS,
  type Layout,
  LayoutsDocument,
  leafWith,
  missing,
  movePanel,
  panelsIn,
  treeOf,
} from "./panels";

const stacked = LAYOUTS[0] as Layout;

describe("layouts", () => {
  test("every layout holds each panel once", () => {
    // arrange
    // act
    const whole = LAYOUTS.map((layout) => isWhole(layout.tree));
    const closed = LAYOUTS.map((layout) => missing(layout.tree));

    // assert
    expect(whole.every(Boolean)).toBe(true);
    expect(closed.every((each) => each.length === 0)).toBe(true);
  });

  test("closing a leaf's only panel lets its sibling take the split", () => {
    // arrange
    // act
    const tree = closePanel(closePanel(stacked.tree, "components"), "viewer");

    // assert
    expect(missing(tree)).toEqual(["components", "viewer"]);
    expect(findLeaf(tree, "stacked/rail")).toBeNull();
    expect(tree.kind === "split" && tree.children[1]?.kind).toBe("leaf");
  });

  test("the code never closes", () => {
    // arrange
    // act
    const tree = closePanel(stacked.tree, "code");

    // assert
    expect(tree).toBe(stacked.tree);
  });

  test("moving a panel takes it out of its leaf and puts it in front", () => {
    // arrange
    // act
    const tree = movePanel(stacked.tree, "threads", "stacked/rail");

    // assert
    expect(findLeaf(tree, "stacked/drawer")?.tabs).toEqual(["commits"]);
    expect(findLeaf(tree, "stacked/rail")).toMatchObject({
      tabs: ["components", "threads"],
      active: "threads",
    });
  });

  test("a closed panel moves back in", () => {
    // arrange
    const closed = closePanel(stacked.tree, "threads");

    // act
    const tree = movePanel(closed, "threads", "stacked/code");

    // assert
    expect(leafWith(tree, "threads")?.id).toBe("stacked/code");
    expect(isWhole(tree)).toBe(true);
  });

  test("a leaf's only panel cannot move into itself", () => {
    // arrange
    // act
    const tree = movePanel(stacked.tree, "components", "stacked/rail");

    // assert
    expect(panelsIn(tree)).toEqual(panelsIn(stacked.tree));
  });

  test("an edit that lost the code gives way to the layout", () => {
    // arrange
    const broken = LayoutsDocument.parse({
      ...DEFAULT_LAYOUTS,
      edited: {
        stacked: {
          kind: "leaf",
          id: "x",
          tabs: ["commits"],
          active: "commits",
        },
      },
    });

    // act
    const tree = treeOf(broken, stacked);

    // assert
    expect(tree).toBe(stacked.tree);
  });
});
```
