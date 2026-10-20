// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components>>[init]
import * as z from "zod";
import type { AsyncState } from "./asyncState";
import type { FileDiff } from "./diff";
import { readPatch } from "./patch";
import type { PlaceVersion } from "./review";

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

/** The colours a kind can take: the graph's lanes, which have a readable
 *  shade in either theme, and the grey of the parts a reader skims. */
export const KIND_COLOURS = {
  ink: "var(--graph-lane-0)",
  blue: "var(--graph-lane-1)",
  green: "var(--graph-lane-2)",
  purple: "var(--graph-lane-3)",
  amber: "var(--graph-lane-4)",
  teal: "var(--graph-lane-5)",
  red: "var(--graph-lane-6)",
  grey: "var(--text-faint)",
} as const;
export const KindColour = z.enum(
  Object.keys(KIND_COLOURS) as [keyof typeof KIND_COLOURS],
);
export type KindColour = z.infer<typeof KindColour>;

/** One word of a repository's vocabulary for what a component is. */
export const ComponentKind = z.object({
  /** It names a class, so it is a slug. */
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "a kind is lowercase letters, digits and -"),
  /** How an agent tells a component of this kind, in a sentence or two. */
  advice: z.string().default(""),
  /** A kind stored without one takes a colour no other kind asked for. */
  colour: KindColour.optional(),
});
export type ComponentKind = z.infer<typeof ComponentKind>;

/** The vocabulary a repository starts with. */
export const DEFAULT_KINDS: ComponentKind[] = [
  {
    name: "schema",
    colour: "ink",
    advice:
      "A type, validator or table that says what data looks like: a zod schema, an interface, a column.",
  },
  {
    name: "action",
    colour: "blue",
    advice:
      "Code that changes state when something happens: a handler, a reducer case, a setter.",
  },
  {
    name: "view",
    colour: "green",
    advice: "Code that draws: a React component and the markup it returns.",
  },
  {
    name: "styles",
    colour: "purple",
    advice: "CSS, and the class names it hangs on.",
  },
  {
    name: "command",
    colour: "amber",
    advice:
      "An entry point something outside calls: an HTTP route, an MCP tool, a CLI subcommand, a store command.",
  },
  {
    name: "helper",
    colour: "teal",
    advice:
      "A function other components call that holds no state of its own: parsing, formatting, a computation.",
  },
  {
    name: "test",
    colour: "red",
    advice: "Tests and their fixtures.",
  },
  {
    name: "wiring",
    colour: "grey",
    advice:
      "Code that only passes things along: imports, props threaded through, a route registered. Its role is usually wires.",
  },
];

/** `kinds` with `kind` just before the kind named `before`, or else in
 *  place of the kind of its name, or else at the end. */
export function withKind(
  kinds: ComponentKind[],
  kind: ComponentKind,
  before?: string,
): ComponentKind[] {
  const others = kinds.filter((kept) => kept.name !== kind.name);
  const at =
    before === undefined
      ? kinds.findIndex((kept) => kept.name === kind.name)
      : others.findIndex((kept) => kept.name === before);
  return at === -1
    ? [...others, kind]
    : [...others.slice(0, at), kind, ...others.slice(at)];
}

/** The colour each kind is drawn in. A kind with none of its own takes,
 *  in vocabulary order, the next colour no kind asked for, so a reader can
 *  still tell it apart; once those run out it is grey. */
export function coloursOf(kinds: ComponentKind[]): Map<string, KindColour> {
  const asked = new Set(kinds.map((kind) => kind.colour));
  const free = KindColour.options.filter(
    (colour) => colour !== "grey" && !asked.has(colour),
  );
  return new Map(
    kinds.map((kind) => [kind.name, kind.colour ?? free.shift() ?? "grey"]),
  );
}

/** A rule giving each kind its colour. */
export function kindColours(kinds: ComponentKind[]): string {
  return [...coloursOf(kinds)]
    .map(
      ([name, colour]) =>
        `.components-kind--${name} { --component: ${KIND_COLOURS[colour]}; }`,
    )
    .join("\n");
}

/** One piece of work a commit does, named for what it is. */
export const Component = z.object({
  commitId: z.string(),
  /** The same in every version, so each version's map names the same
   *  component the same way. */
  id: z.string().min(1),
  /** What it is, a word of the repository's vocabulary when it was
   *  written. */
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

/** Components of one commit that make one part of the change, as the agent
 *  sees it, which the rail can arrange the commit by. */
export const ComponentGroup = z.object({
  commitId: z.string(),
  /** The same in every version, as a component's is. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** What it is, in a sentence. */
  gist: z.string().default(""),
  /** Ids of the commit's components, each in one group at most. */
  components: z.array(z.string()).min(1),
});
export type ComponentGroup = z.infer<typeof ComponentGroup>;

/** What each commit of one version of a series builds, component by
 *  component. */
export const ComponentMap = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  components: z.array(Component),
  /** Maps written before groups have none. */
  groups: z.array(ComponentGroup).default([]),
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

/** The components and groups of a series' maps, the versions in `first`
 *  ahead of the rest. A commit two versions share is in both maps, so each
 *  of its components and groups is kept once, from the version first in
 *  that order. */
export function seriesComponents(
  maps: ComponentMap[],
  series: string,
  first: string[],
): { components: Component[]; groups: ComponentGroup[] } {
  const rank = (map: ComponentMap) => {
    const at = first.indexOf(map.version);
    return at === -1 ? first.length : at;
  };
  const ordered = maps
    .filter((map) => map.series === series)
    .sort((a, b) => rank(a) - rank(b));
  const once = <T extends { commitId: string; id: string }>(all: T[]) => {
    const seen = new Set<string>();
    return all.filter((each) => {
      const key = `${each.commitId}|${each.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    components: once(ordered.flatMap((map) => map.components)),
    groups: once(ordered.flatMap((map) => map.groups)),
  };
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

interface ChangedLine {
  ref: PlaceRef | null;
  kind: "added" | "removed";
  code: string;
}

/** The place each changed line of `file` belongs to, in drawn order. */
function changedPlaces(
  components: Component[],
  trees: RowTrees,
  file: FileDiff,
): ChangedLine[] {
  const paths = pathsOf(file);
  const out: ChangedLine[] = [];
  for (const hunk of readPatch(file.patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") {
        const ref = placeAt(components, trees.after, paths.after, line.newLine);
        out.push({ ref, kind: "added", code: line.code });
      } else if (line.kind === "removed") {
        const ref = placeAt(
          components,
          trees.before,
          paths.before,
          line.oldLine,
        );
        out.push({ ref, kind: "removed", code: line.code });
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

/** Whether a line of `b` folds, and is marked seen, with the heading of
 *  `a`. A commit's own diff folds one place. An interdiff folds the
 *  component's whole share of the file, since which place of one version
 *  pairs with which of the other is only loosely known. */
export function sameFold(trees: RowTrees, a: PlaceRef, b: PlaceRef): boolean {
  return trees.before?.side === "after"
    ? a.component.id === b.component.id
    : placeKey(a) === placeKey(b);
}

/** What the reader marks seen under the heading of `ref` in `file`: a
 *  digest of the lines it folds, so a later version that changes them reads
 *  unseen. */
export function placeVersion(
  components: Component[],
  trees: RowTrees,
  file: FileDiff,
  ref: PlaceRef,
): PlaceVersion {
  let hash = 0x811c9dc5;
  for (const line of changedPlaces(components, trees, file)) {
    if (line.ref === null || !sameFold(trees, ref, line.ref)) continue;
    for (const char of `${line.kind === "added" ? "+" : "-"}${line.code}\n`) {
      hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
    }
  }
  return {
    componentId: ref.component.id,
    path: pathsOf(file).after,
    lines: (hash >>> 0).toString(16).padStart(8, "0"),
  };
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

/** An added line of a row's diff, in the place it belongs to. */
export interface AddedLine {
  ref: PlaceRef;
  path: string;
  /** Counted on the after side. */
  line: number;
}

/** The added line of component `id` that brings `word` in: the first that
 *  declares it, or else the first that names it, and whether it declares. A
 *  component's first place is often an import, which names it too. */
export function wordAdded(
  word: string,
  id: string,
  components: Component[],
  trees: RowTrees,
  files: FileDiff[],
): { at: AddedLine; declares: boolean } | null {
  const name = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
  const declared = new RegExp(
    `\\b(?:function|class|interface|type|enum|const|let|var|def|fn|struct)\\s+${name}(?![\\w-])|^\\s*(?:readonly\\s+)?${name}\\??\\s*:`,
  );
  let first: AddedLine | null = null;
  for (const file of files) {
    const path = pathsOf(file).after;
    for (const hunk of readPatch(file.patch).hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== "added" || !named.test(line.code)) continue;
        const ref = placeAt(components, trees.after, path, line.newLine);
        if (ref?.component.id !== id) continue;
        const at = { ref, path, line: line.newLine };
        if (declared.test(line.code)) return { at, declares: true };
        first ??= at;
      }
    }
  }
  return first === null ? null : { at: first, declares: false };
}

/** A line of a row's diff that names a component it is not part of. */
export interface Reference {
  /** The component the line names. */
  to: Component;
  word: string;
  path: string;
  /** Counted on the after side. */
  line: number;
  code: string;
  /** Whether the row adds the line, or only shows it as context. */
  added: boolean;
  /** The place the line belongs to, or null for code no component owns. */
  from: PlaceRef | null;
}

/** Every line of `files` that names a component outside that component's
 *  own places, in the order the diff draws them. Where two versions' maps
 *  give a name, the row's own commit's component takes it. */
export function referencesIn(
  components: Component[],
  trees: RowTrees,
  files: FileDiff[],
): Reference[] {
  const words = new Map<string, Component>();
  for (const each of components) {
    for (const word of each.words) {
      if (!words.has(word) || each.commitId === trees.after.commitId) {
        words.set(word, each);
      }
    }
  }
  const out: Reference[] = [];
  for (const file of files) {
    const path = pathsOf(file).after;
    for (const hunk of readPatch(file.patch).hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== "added" && line.kind !== "context") continue;
        const from =
          line.kind === "added"
            ? placeAt(components, trees.after, path, line.newLine)
            : null;
        const seen = new Set<string>();
        for (const run of marked(line.code, words, true)) {
          const to = run.mark;
          if (to === null || seen.has(to.id) || from?.component.id === to.id) {
            continue;
          }
          seen.add(to.id);
          out.push({
            to,
            word: run.text,
            path,
            line: line.newLine,
            code: line.code,
            added: line.kind === "added",
            from,
          });
        }
      }
    }
  }
  return out;
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
