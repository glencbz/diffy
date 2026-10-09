// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components>>[init]
import * as z from "zod";
import type { AsyncState } from "./asyncState";
import type { FileDiff } from "./diff";
import { readPatch } from "./patch";

/** Lines of one file a commit changes, counted from 1 on `side`, both ends
 *  included. */
export const ComponentPlace = z.object({
  path: z.string(),
  side: z.enum(["before", "after"]).default("after"),
  start: z.number().int().positive(),
  end: z.number().int().positive().optional(),
  /** What this place does for its component, in a few words. */
  about: z.string().default(""),
  /** The place of the same component that this one moves code to or from. */
  moves: z.number().int().nonnegative().optional(),
});
export type ComponentPlace = z.infer<typeof ComponentPlace>;

/** What a component does for its commit, which the rail groups by. */
export const ComponentRole = z.enum([
  "implements",
  "refactors",
  "wires",
  "tests",
]);
export type ComponentRole = z.infer<typeof ComponentRole>;

/** One piece of work a commit does, named for what it is. */
export const Component = z.object({
  commitId: z.string(),
  /** The same in every version, so each version's map names the same
   *  component the same way. */
  id: z.string().min(1),
  /** What it is: schema, command, view, wiring, test. */
  kind: z.string().min(1),
  name: z.string().min(1),
  role: ComponentRole,
  /** What it does, in a sentence. */
  gist: z.string().default(""),
  /** Names in the code that mean this component. */
  words: z.array(z.string()).default([]),
  /** Phrases in the commit's message that describe it. */
  mentions: z.array(z.string()).default([]),
  /** In reading order. */
  places: z.array(ComponentPlace).min(1),
});
export type Component = z.infer<typeof Component>;

/** What each commit of one version of a series builds, component by
 *  component. */
export const ComponentMap = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  components: z.array(Component),
});
export type ComponentMap = z.infer<typeof ComponentMap>;

/** The map of one version of a series, if one was written. */
export function componentsTo(
  maps: ComponentMap[],
  series: string,
  version: string,
): ComponentMap | undefined {
  return maps.find((map) => map.series === series && map.version === version);
}

/** `maps` with `map` in place of any map of the same version. */
export function withComponents(
  maps: ComponentMap[],
  map: ComponentMap,
): ComponentMap[] {
  return [
    ...maps.filter(
      (kept) => kept.series !== map.series || kept.version !== map.version,
    ),
    map,
  ];
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components>>[1]
/** The tree one side of a row's diff counts lines of, as a component names
 *  it: `after` is the commit's own tree, `before` its parent's. */
export interface TreeSide {
  commitId: string;
  side: "before" | "after";
}

/** What each side of a row's diff counts lines of. */
export interface RowTrees {
  before: TreeSide | null;
  after: TreeSide;
}

/** A commit's own diff counts its parent on the left; a comparison of two
 *  commits counts the older one's own tree there. */
export function rowTrees(row: {
  commit: { commitId: string };
  was: { commitId: string } | null;
}): RowTrees {
  return {
    before:
      row.was === null
        ? { commitId: row.commit.commitId, side: "before" }
        : { commitId: row.was.commitId, side: "after" },
    after: { commitId: row.commit.commitId, side: "after" },
  };
}

/** One place of one component. */
export interface PlaceRef {
  component: Component;
  place: number;
}

/** Tells places apart across commits, so an interdiff's two versions of a
 *  component never read as one run. */
export function placeKey(ref: PlaceRef): string {
  return `${ref.component.commitId}:${ref.component.id}/${ref.place}`;
}

/** Whether two places read as one run of a diff: the same place, or the
 *  same component in the two versions an interdiff holds side by side, whose
 *  removed and added lines are one change to it. */
export function sameRun(a: PlaceRef, b: PlaceRef): boolean {
  return (
    placeKey(a) === placeKey(b) ||
    (a.component.id === b.component.id &&
      a.component.commitId !== b.component.commitId)
  );
}

/** The places of `drawn` that start a run, which is what a reader counts:
 *  an interdiff's older and newer lines of one place are one. */
export function runStarts(drawn: DrawnPlace[]): DrawnPlace[] {
  return drawn.filter((each, index) => {
    const before = drawn[index - 1];
    return !(
      before !== undefined &&
      before.path === each.path &&
      sameRun(before.ref, each.ref)
    );
  });
}

/** The place a line of `tree` belongs to, if any. */
export function placeAt(
  components: Component[],
  tree: TreeSide | null,
  path: string,
  line: number,
): PlaceRef | null {
  if (tree === null) return null;
  for (const component of components) {
    if (component.commitId !== tree.commitId) continue;
    const place = component.places.findIndex(
      (each) =>
        each.side === tree.side &&
        each.path === path &&
        line >= each.start &&
        line <= (each.end ?? each.start),
    );
    if (place !== -1) return { component, place };
  }
  return null;
}

function pathsOf(file: FileDiff): { before: string; after: string } {
  return "path" in file
    ? { before: file.path, after: file.path }
    : { before: file.oldPath, after: file.newPath };
}

/** The place each changed line of `file` belongs to, in drawn order. */
function changedPlaces(
  components: Component[],
  trees: RowTrees,
  file: FileDiff,
): { ref: PlaceRef | null; kind: "added" | "removed" }[] {
  const paths = pathsOf(file);
  const out: { ref: PlaceRef | null; kind: "added" | "removed" }[] = [];
  for (const hunk of readPatch(file.patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") {
        const ref = placeAt(components, trees.after, paths.after, line.newLine);
        out.push({ ref, kind: "added" });
      } else if (line.kind === "removed") {
        const ref = placeAt(
          components,
          trees.before,
          paths.before,
          line.oldLine,
        );
        out.push({ ref, kind: "removed" });
      }
    }
  }
  return out;
}

/** A place as one row's diff draws it. */
export interface DrawnPlace {
  ref: PlaceRef;
  path: string;
  added: number;
  removed: number;
}

/** The places a row's diff changes, once each, in the order it draws them. */
export function drawnPlaces(
  components: Component[],
  trees: RowTrees,
  files: FileDiff[],
): DrawnPlace[] {
  const out: DrawnPlace[] = [];
  for (const file of files) {
    const path = pathsOf(file).after;
    for (const { ref, kind } of changedPlaces(components, trees, file)) {
      if (ref === null) continue;
      let drawn = out.find(
        (each) => each.path === path && placeKey(each.ref) === placeKey(ref),
      );
      if (drawn === undefined) {
        drawn = { ref, path, added: 0, removed: 0 };
        out.push(drawn);
      }
      if (kind === "added") drawn.added++;
      else drawn.removed++;
    }
  }
  return out;
}

/** One component's share of a file's changed lines, or the share no
 *  component owns. */
export interface FileShare {
  id: string | null;
  lines: number;
  /** Where its lines start, to go to. */
  first: PlaceRef | null;
}

/** A file's changed lines by component, in the order `components` lists
 *  them, with what no component owns last. */
export function fileShares(
  components: Component[],
  trees: RowTrees,
  file: FileDiff,
): FileShare[] {
  const counts = new Map<string | null, FileShare>();
  for (const { ref } of changedPlaces(components, trees, file)) {
    const id = ref?.component.id ?? null;
    const share = counts.get(id) ?? { id, lines: 0, first: ref };
    share.lines++;
    counts.set(id, share);
  }
  const order = [...new Set(components.map((each) => each.id)), null];
  return order.flatMap((id) => {
    const share = counts.get(id);
    return share === undefined ? [] : [share];
  });
}

/** How a place stands against another version. */
export type Fate = "new" | "removed" | "changed" | "unchanged";

/** In a comparison of two versions of a commit, a component only the newer
 *  one has is new, and one only the older has is gone. When the older
 *  version has no map, nothing can be called new. */
export function interdiffFate(
  ref: PlaceRef,
  older: Component[],
  newer: Component[],
): Fate {
  const isNewer = newer.some((each) => each === ref.component);
  const other = isNewer ? older : newer;
  if (other.length === 0) return "changed";
  if (other.some((each) => each.id === ref.component.id)) return "changed";
  return isNewer ? "new" : "removed";
}

/** The other version a commit's own diff is held against, and the
 *  comparison of the commit with its counterpart there. `since` holds an
 *  older version against this one, `until` a newer one. */
export interface Counterpart {
  direction: "since" | "until";
  /** The counterpart commit's components, empty when it has no map. */
  components: Component[];
  /** The comparison of the older of the two commits with the newer. */
  files: FileDiff[];
}

/** How a place of a commit's own diff fares in its counterpart version. A
 *  place counts as changed when the comparison touches its lines, which it
 *  counts on this commit's side: the newer side holding an older version
 *  against this one, the older side holding a newer. */
export function counterpartFate(
  ref: PlaceRef,
  path: string,
  counterpart: Counterpart,
): Fate {
  const there = counterpart.components.some(
    (each) => each.id === ref.component.id,
  );
  if (counterpart.components.length > 0 && !there) {
    return counterpart.direction === "since" ? "new" : "removed";
  }
  const place = ref.component.places[ref.place];
  if (place === undefined || place.side !== "after") return "unchanged";
  const end = place.end ?? place.start;
  const inside = (line: number) => line >= place.start && line <= end;
  for (const file of counterpart.files) {
    if (pathsOf(file).after !== path) continue;
    for (const hunk of readPatch(file.patch).hunks) {
      for (const line of hunk.lines) {
        if (
          counterpart.direction === "since"
            ? line.kind === "added" && inside(line.newLine)
            : line.kind === "removed" && inside(line.oldLine)
        ) {
          return "changed";
        }
      }
    }
  }
  return "unchanged";
}

/** A run of text, marked when it names something. */
export type Marked<T> = { text: string; mark: T | null };

/** `text` cut where any of `marks` appears, longest first. A word only
 *  counts whole, so `Reply` is not found inside `replyToComment`; a phrase
 *  counts wherever it appears. */
export function marked<T>(
  text: string,
  marks: ReadonlyMap<string, T>,
  whole: boolean,
): Marked<T>[] {
  const keys = [...marks.keys()].filter((key) => key !== "");
  if (keys.length === 0) return [{ text, mark: null }];
  const escaped = keys
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    whole
      ? `(?<![\\w-])(${escaped.join("|")})(?![\\w-])`
      : `(${escaped.join("|")})`,
    "g",
  );
  const out: Marked<T>[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const found = match[1] ?? "";
    const start = match.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), mark: null });
    out.push({ text: found, mark: marks.get(found) ?? null });
    last = start + found.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: null });
  return out;
}

/** Whether a commit's message describes `component`, whitespace aside. */
export function mentionedIn(description: string, component: Component) {
  const text = description.replace(/\s+/g, " ");
  return component.mentions.some((phrase) =>
    text.includes(phrase.replace(/\s+/g, " ")),
  );
}

/** A version as the comparison picker names it: `v2`. */
export interface NamedVersion {
  id: string;
  name: string;
}

/** A commit's counterpart in the version its own diff is held against,
 *  with the comparison of the two as it loads. */
export interface RowCounterpart {
  direction: Counterpart["direction"];
  version: NamedVersion;
  commitId: string;
  components: Component[];
  files: AsyncState<FileDiff[]>;
}

/** The version a version's own diffs are held against, and each commit's
 *  counterpart there. A commit with none is new in its version, or gone
 *  from the next. */
export interface Counterparts {
  version: NamedVersion | null;
  direction: Counterpart["direction"];
  of: (commitId: string) => RowCounterpart | null;
}
// ~/~ end
