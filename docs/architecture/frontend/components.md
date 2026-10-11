# Components

A component map names what each part of a series' changes is, such as a
schema, a command, a view or the wiring between them, so a reader can see
what a commit builds and move between the parts that belong together. An
agent writes it; the reader reads it laid over the series screens.

## The component map

A map belongs to one version of a series, since its places name line numbers
that only that version's commits have. It
sits in the [review document](review.md#review-state), so an agent writes it
through the same store and every open screen hears about it.

A component belongs to one commit, and keeps its `id` across versions. Two
versions' maps then agree on which component is which, so a reader comparing
versions can be told that a component is new, gone or changed without the
agent having to say so.

A place is a run of lines on one side of the commit's diff, as a comment's
anchor is: the `after` side counts the commit's own tree and the `before`
side its parent's. Code that moved is two places of one component that name
each other: the removed lines where it left, and the added lines where it
arrived, so the reader is told which way it went.

```ts
//| id: frontend-model-components
//| file: src/frontend/model/components.ts
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
```

## Reading a row

A line is found by the tree its side of the diff counts: on a commit's own
diff the left side is the commit's parent, which its `before` places name,
and the right side is the commit; on a comparison of two versions the left
side is the older commit's own tree. So one lookup serves a row, a
comment's line and a peek at another comparison alike, in either layout and
either diff mode, through the anchors the [diff view](diff.md#line-decor)
already gives each line.

A place is changed against another version when that comparison touches its
lines, rather than when the agent says so. The agent writes one version at a
time and cannot know what the reader will hold it against; the comparison is
the same one the screen draws, so the two never disagree.

```ts
//| id: frontend-model-components
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
```

## Holding a version against another

Read against its base, a version's components say whether each changed since
the version before, or for the first version whether the next one changes
it. `useCounterpart` pairs the two versions' commits and loads their
comparisons the way the [series screen](pull-requests.md#series-review-controller)
does for two versions it shows, so a heading's "changed since v1" and the
interdiff it opens agree. A commit's own diff in another version loads only
when a peek asks for it.

```ts
//| id: frontend-state-components
//| file: src/frontend/state/components.ts
import { useState } from "react";
import type { AsyncState } from "../model/asyncState";
import {
  type ComponentMap,
  type Counterparts,
  componentsTo,
  type RowCounterpart,
} from "../model/components";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import type { Slot } from "../model/pairing";
import {
  rowAsk,
  type SeriesSource,
  type SeriesVersion,
  versionAsk,
  versionName,
} from "../model/series";
import { usePairing } from "./pairing";
import { slotKey, useRowDiffs } from "./rowDiffs";
import { useSeriesCommits } from "./series";

const NO_COMMITS: GitCommit[] = [];

const LOADING: AsyncState<FileDiff[]> = { status: "loading" };

/** The version a version's own diffs are held against, so a reader can see
 *  which places changed: the one before it, or the one after for the first
 *  version. Its commits are paired with this version's and compared, the
 *  same way the series screen pairs two versions. */
export function useCounterpart({
  source,
  series,
  versions,
  to,
  commits,
  maps,
  enabled,
}: {
  source: SeriesSource;
  series: string;
  versions: SeriesVersion[];
  to: string;
  /** The commits of `to`. */
  commits: GitCommit[];
  maps: ComponentMap[];
  enabled: boolean;
}): Counterparts {
  const index = versions.findIndex((version) => version.id === to);
  const before = versions[index - 1];
  const after = versions[index + 1];
  const other = !enabled
    ? null
    : before !== undefined
      ? { id: before.id, since: true }
      : after !== undefined
        ? { id: after.id, since: false }
        : null;

  const loaded = useSeriesCommits(
    other === null ? null : versionAsk(source, other.id),
  );
  const theirs = loaded.status === "ready" ? loaded.data : NO_COMMITS;
  const since = other?.since ?? true;
  const pairing = usePairing(
    since ? theirs : commits,
    since ? commits : theirs,
    null,
  );
  const diffs = useRowDiffs(
    other === null
      ? rowAsk(source, { kind: "base" }, to)
      : rowAsk(
          source,
          { kind: "version", id: since ? other.id : to },
          since ? to : other.id,
        ),
    other === null ? [] : pairing.slots,
  );
  const map = other === null ? undefined : componentsTo(maps, series, other.id);

  const of = (commitId: string): RowCounterpart | null => {
    if (other === null) return null;
    const slot = pairing.slots.find(
      (each) =>
        each.left !== null &&
        each.right !== null &&
        (since ? each.right : each.left) === commitId,
    );
    const theirId = since ? slot?.left : slot?.right;
    if (slot === undefined || theirId == null) return null;
    return {
      direction: since ? "since" : "until",
      version: { id: other.id, name: versionName(versions, other.id) },
      commitId: theirId,
      components:
        map?.components.filter((each) => each.commitId === theirId) ?? [],
      files: diffs.get(slotKey(slot)) ?? LOADING,
    };
  };
  return {
    version:
      other === null
        ? null
        : { id: other.id, name: versionName(versions, other.id) },
    direction: since ? "since" : "until",
    of,
  };
}

/** Each asked-for commit's own diff, from either version on screen. A peek
 *  asks for one when the reader points at it, so nothing loads unasked. */
export function useOwnDiffs({
  source,
  from,
  to,
  fromCommits,
  toCommits,
}: {
  source: SeriesSource;
  from: string | null;
  to: string;
  fromCommits: GitCommit[];
  toCommits: GitCommit[];
}): [ReadonlyMap<string, AsyncState<FileDiff[]>>, (commitId: string) => void] {
  const [wanted, setWanted] = useState<ReadonlySet<string>>(new Set());
  const slotsIn = (commits: GitCommit[]): Slot[] =>
    commits
      .filter((commit) => wanted.has(commit.commitId))
      .map((commit) => ({ left: null, right: commit.commitId }));
  const fromDiffs = useRowDiffs(
    rowAsk(source, { kind: "base" }, from ?? to),
    from === null ? [] : slotsIn(fromCommits),
  );
  const toDiffs = useRowDiffs(
    rowAsk(source, { kind: "base" }, to),
    slotsIn(toCommits),
  );
  const out = new Map<string, AsyncState<FileDiff[]>>();
  for (const id of wanted) {
    const key = slotKey({ left: null, right: id });
    const found = toDiffs.get(key) ?? fromDiffs.get(key);
    if (found !== undefined) out.set(id, found);
  }
  return [
    out,
    (commitId) =>
      setWanted((now) =>
        now.has(commitId) ? now : new Set(now).add(commitId),
      ),
  ];
}
```

## The components view

`ComponentsStack` wraps the [commit stack](commit-stack.md) and hands it a
`StackLayer`, which reaches each file's lines through the
[diff view's](diff.md#line-decor) `LineDecor`. So every comparison, layout,
comment and fold the series screens have still works under it. Each run of one place's changed lines starts with a heading that
names the component, what kind it is, and what this place does; the code is
never reordered or hidden.

Changing the comparison keeps the reader's place. A heading's way to another
comparison remembers where the heading sat on screen, and once the new
comparison's rows load, the same place lands at the same height, until the
reader scrolls for themselves. Every jump,
whether to another comparison, a move's other end, a word in the code or a
phrase in the message, leaves a step on a trail back. A link to a component
that two versions compared leave out as unchanged opens the newer version's
own diff at it, one only the other version has opens the two compared, and a
name or phrase that leads nowhere stays plain text. A jump into a folded file
unfolds it, as the reader would.

The commit message takes part: a phrase that describes a component links to
it, and a heading links back to the phrase, unfolding the message the way the
reader would, so folding it again works as it always does.

The stack sits inside this view whether the map is on or off, so switching
it keeps every file's folds and opened gaps. The layer changes only when what
it draws does: a hover, a peek or the reading line moving draws this view
again, never the diff under it, and the solid bar on the place being read is
a style rule rather than a class on its lines.

```tsx
//| id: frontend-view-components-stack
//| file: src/frontend/views/Components/ComponentsStack.tsx
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AsyncState } from "../../model/asyncState";
import { fileAnchor } from "../../model/changedFiles";
import {
  type Component,
  type Counterparts,
  counterpartFate,
  type DrawnPlace,
  drawnPlaces,
  type Fate,
  fileShares,
  interdiffFate,
  marked,
  mentionedIn,
  type NamedVersion,
  type PlaceRef,
  placeAt,
  placeKey,
  type RowTrees,
  rowTrees,
  runStarts,
  sameRun,
} from "../../model/components";
import type { FileDiff } from "../../model/diff";
import type { Comment } from "../../model/review";
import type { StackLayer, StackRow } from "../CommitStack";
import type { LineDecor } from "../DiffView/FileRow/FileRow";
import { paneSize, Splitter } from "../Splitter";
import { Heading, type HeadingParts, type Switch } from "./Heading";
import { Peek, type Peeked } from "./Peek";
import { Rail, type RailEntry } from "./Rail";
import { Trail } from "./Trail";

type CodeLine = Parameters<LineDecor["lineClass"]>[0];

export interface ComponentsStackProps {
  /** Off, the stack draws as it would without a map, still inside this
   *  view, so switching the map on or off keeps every file's state. */
  enabled: boolean;
  rows: StackRow[];
  /** Every component of the versions the screen compares, and of the
   *  version the rows are held against. */
  components: Component[];
  /** The row the address names, which the rail describes. */
  current: string | null;
  open: ReadonlySet<string>;
  onOpenRow: (key: string) => void;
  /** Shows a row's whole message, as the reader can by unfolding it. */
  onExpandMessage: (key: string) => void;
  /** The comparison on screen; a null `from` is the base. */
  from: NamedVersion | null;
  to: NamedVersion;
  /** The version a commit's own diff is held against, and each commit's
   *  counterpart there. */
  counterparts: Counterparts;
  /** Each commit's own diff, once asked for. */
  ownDiffs: ReadonlyMap<string, AsyncState<FileDiff[]>>;
  onWantOwn: (commitId: string) => void;
  /** Opens another comparison, at `commit` when one is named. */
  onCompare: (from: string | null, to: string, commit: string | null) => void;
  /** Every comment in the review document. */
  comments: Comment[];
  split: boolean;
  /** The rail's width as the reader dragged it, or null for the default. */
  railSize: number | null;
  onRailResize: (size: number | null) => void;
  children: (layer: StackLayer | undefined) => ReactNode;
}

/** What to land on: a heading by its place or component, or anything else
 *  by a selector. */
interface Target {
  key: string | null;
  id: string;
  path: string | null;
  selector: string | null;
}

/** Where the reader asked to land, held at a height on screen. */
interface Landing extends Target {
  /** Pixels from the top of the window, or null for the reading line. */
  y: number | null;
  at: number;
  opened: boolean;
  /** Once landed, until when to keep it there while the page settles. */
  settle: number | null;
  /** The comparison it lands in, so a switch does not land on the page it
   *  is leaving. */
  on: string;
}

/** A place the reader can go back to. */
interface Step {
  label: string;
  from: string | null;
  to: string;
  /** The commit the address named there. */
  commit: string | null;
  target: Target;
  /** The row whose message the step was, to show it whole again. */
  message: string | null;
  /** Where on screen the place was, to land it there again. */
  y: number | null;
}

/** A place stays looked for this long while its comparison loads. */
const PATIENCE = 8000;
/** And is held where it landed this long while the page around it loads,
 *  unless the reader scrolls first. */
const SETTLE = 1200;

const comparisonKey = (from: string | null, to: string) =>
  `${from ?? "base"}>${to}`;

/** A component id as part of a class name. */
const ident = (id: string) => id.replace(/[^\w-]/g, "_");

export function ComponentsStack(props: ComponentsStackProps) {
  const {
    enabled,
    rows,
    components,
    current,
    open,
    onOpenRow,
    from,
    to,
    counterparts,
    comments,
    split,
    railSize,
    onRailResize,
    children,
  } = props;
  const here = comparisonKey(from?.id ?? null, to.id);
  const counterpartOf = counterparts.of;
  const body = useRef<HTMLDivElement>(null);
  const leaving = useRef(0);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [trail, setTrail] = useState<Step[]>([]);
  // The browser's own Back leaves the trail's steps pointing at a page the
  // reader has already gone back past, so it forgets them.
  useEffect(() => {
    const forget = () => setTrail([]);
    window.addEventListener("popstate", forget);
    return () => window.removeEventListener("popstate", forget);
  }, []);
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [reading, setReading] = useState<{
    id: string;
    path: string;
  } | null>(null);

  const placesOf = useMemo(() => {
    const out = new Map<string, DrawnPlace[]>();
    for (const row of rows) {
      if (row.files.status !== "ready" || row.kind === "dropped") continue;
      out.set(row.key, drawnPlaces(components, rowTrees(row), row.files.data));
    }
    return out;
  }, [rows, components]);
  const commitsOf = (commitId: string) =>
    components.filter((each) => each.commitId === commitId);

  const versionOf = (commitId: string) => {
    for (const row of rows) {
      if (row.commit.commitId === commitId) return to.name;
      if (row.was?.commitId === commitId) return from?.name ?? "";
      const counterpart = counterpartOf(row.commit.commitId);
      if (counterpart?.commitId === commitId) return counterpart.version.name;
    }
    return commitId.slice(0, 7);
  };

  // A line comment counts lines of its commit's own tree on the after side
  // and of the commit's parent on the before side, as a place does.
  const commentsOn = (id: string) =>
    comments.filter(
      (comment) =>
        comment.kind === "line" &&
        placeAt(
          components,
          { commitId: comment.commitId, side: comment.side },
          comment.path,
          comment.line,
        )?.component.id === id,
    );

  /** Where a thread's line is drawn in this comparison, if it is. A
   *  comparison of two commits keeps the older one's lines on its left,
   *  counted as that commit's own tree. */
  const threadAt = (comment: Comment): string | null => {
    if (comment.kind !== "line") return null;
    for (const row of rows) {
      const side =
        comment.commitId === row.commit.commitId
          ? row.was === null
            ? comment.side
            : comment.side === "after"
              ? "after"
              : null
          : comment.commitId === row.was?.commitId && comment.side === "after"
            ? "before"
            : null;
      if (side !== null) {
        return `.diff-file[data-path="${CSS.escape(comment.path)}"] [data-anchor="${side}:${comment.line}"]`;
      }
    }
    return null;
  };

  // Whatever scrolls the stack: the diff pane on a wide screen, the panes'
  // drawer on a phone.
  const scroller = () => {
    for (
      let at = body.current?.parentElement ?? null;
      at !== null;
      at = at.parentElement
    ) {
      const overflow = getComputedStyle(at).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        at.scrollHeight > at.clientHeight + 1
      ) {
        return at;
      }
    }
    return null;
  };
  const readingLine = () => {
    const pane = scroller();
    return pane === null
      ? innerHeight * 0.3
      : pane.getBoundingClientRect().top + pane.clientHeight * 0.3;
  };
  const headings = () => [
    ...(body.current?.querySelectorAll<HTMLElement>("[data-components-key]") ??
      []),
  ];
  const find = (target: Target): HTMLElement | null => {
    if (target.selector !== null) {
      return body.current?.querySelector<HTMLElement>(target.selector) ?? null;
    }
    const all = headings();
    const onPath = (each: HTMLElement) =>
      target.path === null || each.dataset.path === target.path;
    return (
      all.find(
        (each) => each.dataset.componentsKey === target.key && onPath(each),
      ) ??
      all.find((each) => each.dataset.componentsKey === target.key) ??
      all.find(
        (each) => each.dataset.componentsId === target.id && onPath(each),
      ) ??
      all.find((each) => each.dataset.componentsId === target.id) ??
      null
    );
  };

  // A new comparison loads its rows and diffs after the ask, so landing
  // tries after every render until the target is drawn, opening the row
  // that holds it on the way.
  useLayoutEffect(() => {
    if (landing === null || landing.on !== here) return;
    const element = find(landing);
    if (element === null) {
      if (Date.now() - landing.at > PATIENCE) {
        setLanding(null);
        return;
      }
      const row = rows.find((each) =>
        placesOf
          .get(each.key)
          ?.some(
            (drawn) =>
              placeKey(drawn.ref) === landing.key ||
              drawn.ref.component.id === landing.id,
          ),
      );
      if (row !== undefined && !open.has(row.key) && !landing.opened) {
        onOpenRow(row.key);
        setLanding({ ...landing, opened: true });
      } else if (row !== undefined && open.has(row.key)) {
        // A folded file, or one marked viewed, holds it: unfold it the way
        // the reader would, so folding it again works as it always does.
        const paths = (placesOf.get(row.key) ?? [])
          .filter(
            (drawn) =>
              placeKey(drawn.ref) === landing.key ||
              drawn.ref.component.id === landing.id,
          )
          .map((drawn) => drawn.path);
        for (const path of landing.path === null ? paths : [landing.path]) {
          const toggle = document
            .getElementById(fileAnchor(row.commit.commitId, path))
            ?.querySelector<HTMLElement>(
              '.diff-file__toggle[aria-expanded="false"]',
            );
          if (toggle != null) {
            toggle.click();
            // The file draws itself; this view tries again once it has.
            setLanding({ ...landing });
            break;
          }
        }
      }
      return;
    }
    // Highlighting and the rows above still load after the target is drawn,
    // so it is held where it was asked for until they settle.
    const want = landing.y ?? readingLine() - 24;
    const by = element.getBoundingClientRect().top - want;
    const pane = scroller();
    if (pane !== null) pane.scrollTop += by;
    else window.scrollBy(0, by);
    if (landing.settle === null) {
      flash(element);
      // A switch that keeps the heading's height can leave it below the
      // reading line, and the rail should still name it.
      const id = element.dataset.componentsId;
      if (id !== undefined)
        setReading({ id, path: element.dataset.path ?? "" });
      setLanding({ ...landing, settle: Date.now() + SETTLE });
    } else if (Date.now() > landing.settle) {
      setLanding(null);
    }
  });
  const landingNow = landing !== null;
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  useEffect(() => {
    if (!landingNow) return;
    // A target still loading needs a nudge to look again.
    const timer = setInterval(
      () => setLanding((now) => (now === null ? null : { ...now })),
      150,
    );
    // The reader scrolling is the reader taking over.
    const stop = () => setLanding(null);
    const options = { passive: true, capture: true } as const;
    window.addEventListener("wheel", stop, options);
    window.addEventListener("touchstart", stop, options);
    window.addEventListener("keydown", stop, options);
    window.addEventListener("pointerdown", stop, options);
    return () => {
      window.removeEventListener("pointerdown", stop, options);
      clearInterval(timer);
      window.removeEventListener("wheel", stop, options);
      window.removeEventListener("touchstart", stop, options);
      window.removeEventListener("keydown", stop, options);
    };
  }, [landingNow]);

  // The heading last passed by the reading line is the place being read. A
  // peek belongs to where it was opened, so a scroll closes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listens once, reading the page as it is
  useEffect(() => {
    const panes = body.current?.closest(".panes");
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = readingLine();
      let found: { id: string; path: string } | null = null;
      for (const heading of headings()) {
        if (heading.getBoundingClientRect().top > line) break;
        found = {
          id: heading.dataset.componentsId ?? "",
          path: heading.dataset.path ?? "",
        };
      }
      setReading((now) =>
        now?.id === found?.id && now?.path === found?.path ? now : found,
      );
    };
    const onScroll = (event: Event) => {
      // A peek too long or wide for its box scrolls itself, and stays.
      if (
        event.target instanceof Element &&
        event.target.closest(".components-peek") !== null
      ) {
        return;
      }
      if (frame === 0) frame = requestAnimationFrame(read);
      setPeeked(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeeked(null);
    };
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".components-peek") === null) setPeeked(null);
    };
    // Captured, so a scroll of whichever pane holds the stack is heard.
    panes?.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    read();
    return () => {
      panes?.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      cancelAnimationFrame(frame);
    };
  }, []);

  const [railOpen, setRailOpen] = useState(false);
  const goTo = (target: Target, y: number | null = null, on = here) => {
    setPeeked(null);
    setLanding({
      ...target,
      y,
      at: Date.now(),
      opened: false,
      settle: null,
      on,
    });
  };
  const toPlace = (ref: PlaceRef, path: string | null): Target => ({
    key: placeKey(ref),
    id: ref.component.id,
    path,
    selector: null,
  });
  const tag = () =>
    from === null ? ` (${to.name})` : ` (${from.name}→${to.name})`;
  const step = (
    label: string,
    target: Target,
    commit: string | null,
    message: string | null = null,
  ) => {
    const y = find(target)?.getBoundingClientRect().top ?? null;
    const at = from?.id ?? null;
    setTrail((now) => {
      // A second jump from the same place needs no second way back to it.
      const last = now.at(-1);
      if (last?.label === label && last.from === at && last.to === to.id) {
        return now;
      }
      return [
        ...now,
        { label, from: at, to: to.id, commit, target, message, y },
      ];
    });
  };
  /** The commit the address names while `ref` is on screen: the row's. */
  const rowCommitOf = (ref: PlaceRef) =>
    rows.find(
      (row) =>
        row.commit.commitId === ref.component.commitId ||
        row.was?.commitId === ref.component.commitId,
    )?.commit.commitId ?? ref.component.commitId;
  const remember = (ref: PlaceRef, path: string) =>
    step(`${ref.component.name}${tag()}`, toPlace(ref, path), rowCommitOf(ref));
  /** Remembers the place being read, for a jump that starts from no place. */
  const rememberHere = () => {
    const component = components.find((each) => each.id === reading?.id);
    step(
      component === undefined ? `top${tag()}` : `${component.name}${tag()}`,
      reading === null || component === undefined
        ? { key: null, id: "", path: null, selector: ".components-main" }
        : { key: null, id: reading.id, path: reading.path, selector: null },
      rows.find((row) => row.key === current)?.commit.commitId ?? null,
    );
  };
  const messageTarget = (row: string, id: string | null): Target => ({
    key: null,
    id: id ?? "",
    path: null,
    selector:
      id === null
        ? `.commit-stack__message:has([data-components-message="${CSS.escape(row)}"])`
        : `[data-components-message="${CSS.escape(row)}"][data-components-mention="${CSS.escape(id)}"]`,
  });
  const rememberMessage = (row: StackRow, id: string | null) =>
    step(
      "commit message",
      messageTarget(row.key, id),
      row.commit.commitId,
      row.key,
    );
  /** Shows a commit's message whole, at the phrase describing `id`. */
  const showMessage = (row: string, id: string | null) => {
    props.onExpandMessage(row);
    goTo(messageTarget(row, id));
  };
  /** Opens another comparison with the same place at the same height. */
  const compareAt = (
    nextFrom: string | null,
    nextTo: string,
    ref: PlaceRef,
    path: string,
    heading: HTMLElement | null,
    commit: string,
  ) => {
    remember(ref, path);
    props.onCompare(nextFrom, nextTo, commit);
    goTo(
      toPlace(ref, path),
      heading?.getBoundingClientRect().top ?? null,
      comparisonKey(nextFrom, nextTo),
    );
  };
  const back = (index: number) => {
    const target = trail[index];
    if (target === undefined) return;
    setTrail(trail.slice(0, index));
    if (target.from !== (from?.id ?? null) || target.to !== to.id) {
      props.onCompare(target.from, target.to, target.commit);
    }
    if (target.message !== null) props.onExpandMessage(target.message);
    goTo(target.target, target.y, comparisonKey(target.from, target.to));
  };

  const leave = () => {
    window.clearTimeout(leaving.current);
    leaving.current = window.setTimeout(() => {
      if (document.querySelector(".components-peek:hover") === null) {
        setPeeked((now) => (now?.kind === "lines" ? null : now));
      }
    }, 250);
  };
  const peekLines = (
    target: HTMLElement,
    title: string,
    note: string,
    component: Component,
    files: AsyncState<FileDiff[]>,
    trees: RowTrees,
    path: string,
  ) => {
    window.clearTimeout(leaving.current);
    const box = target.getBoundingClientRect();
    setPeeked({
      kind: "lines",
      title,
      note,
      component,
      files,
      trees,
      path,
      x: box.left,
      y: box.bottom + 6,
      above: box.top - 6,
    });
  };
  // A peek at a diff still loading shows what has landed since.
  const shownPeek: Peeked | null =
    peeked?.kind === "lines" && peeked.files.status === "loading"
      ? {
          ...peeked,
          files:
            props.ownDiffs.get(peeked.trees.after.commitId) ??
            counterpartOf(peeked.trees.after.commitId)?.files ??
            peeked.files,
        }
      : peeked;

  /** The place a drawn line belongs to, in the trees its row draws. */
  const placeOfLine = (
    trees: RowTrees,
    file: FileDiff,
    line: CodeLine,
  ): PlaceRef | null => {
    const before = line.anchor.side === "before";
    const path =
      "path" in file ? file.path : before ? file.oldPath : file.newPath;
    return placeAt(
      components,
      before ? trees.before : trees.after,
      path,
      line.anchor.line,
    );
  };

  const fateOf = (row: StackRow, drawn: DrawnPlace): Fate | null => {
    if (row.was !== null) {
      return interdiffFate(
        drawn.ref,
        commitsOf(row.was.commitId),
        commitsOf(row.commit.commitId),
      );
    }
    const counterpart = counterpartOf(row.commit.commitId);
    if (counterpart === null) {
      if (counterparts.version === null) return null;
      return counterparts.direction === "since" ? "new" : "removed";
    }
    if (counterpart.files.status !== "ready") return null;
    return counterpartFate(drawn.ref, drawn.path, {
      ...counterpart,
      files: counterpart.files.data,
    });
  };

  const headingParts = (
    row: StackRow,
    drawn: DrawnPlace,
    side: "before" | "after",
  ): HeadingParts => {
    const { ref, path } = drawn;
    const { component } = ref;
    // The message link and the threads go on the component's first heading.
    // Side by side, an interdiff draws each version's run in its own column,
    // so it is the first of this version's runs.
    const first =
      (placesOf.get(row.key) ?? []).find(
        (each) =>
          each.ref.component.id === component.id &&
          each.ref.component.commitId === component.commitId,
      ) === drawn;
    const fate = fateOf(row, drawn);
    // Side by side, each column's heading carries its own side, and the after
    // column's carries the rest. A run with no heading in the other column,
    // because nothing of it there is added or removed, carries it all.
    const drawsIn = (lines: "added" | "removed") =>
      (placesOf.get(row.key) ?? []).some(
        (each) =>
          each.path === path && sameRun(each.ref, ref) && each[lines] > 0,
      );
    const rest = !split || side === "after" || !drawsIn("added");
    const own = !split || side === "before" || !drawsIn("removed");
    const sides: Switch[] = [];
    let counterpart: Switch | null = null;
    let words: HeadingParts["fate"] = null;
    if (row.was !== null && from !== null) {
      const was = row.was;
      const side = (version: NamedVersion, commitId: string): Switch => ({
        label: version.name,
        title: `open ${version.name}'s own diff here, at this height`,
        onPeek: (target) => {
          props.onWantOwn(commitId);
          peekLines(
            target,
            `${component.name} as ${version.name} makes it`,
            "",
            component,
            props.ownDiffs.get(commitId) ?? { status: "loading" },
            rowTrees({ commit: { commitId }, was: null }),
            path,
          );
        },
        // A run that joins both versions' lines lands on the version's own.
        onGo: (heading) =>
          compareAt(
            null,
            version.id,
            (placesOf.get(row.key) ?? []).find(
              (each) =>
                each.path === path &&
                each.ref.component.commitId === commitId &&
                sameRun(each.ref, ref),
            )?.ref ?? ref,
            path,
            heading,
            commitId,
          ),
      });
      if (fate === "new" && rest) {
        words = { fate, text: `new in ${to.name}` };
      }
      if (fate === "removed" && own) {
        words = { fate, text: `removed in ${to.name}` };
      }
      if (own && fate !== "new") sides.push(side(from, was.commitId));
      if (rest && fate !== "removed") {
        sides.push(side(to, row.commit.commitId));
      }
    } else if (rest && fate !== null && fate !== "unchanged") {
      const other = counterpartOf(row.commit.commitId);
      const version = other?.version ?? counterparts.version;
      if (version !== null) {
        const since = counterparts.direction === "since";
        const [olderVersion, newerVersion] = since
          ? [version.id, to.id]
          : [to.id, version.id];
        // Each fate leads to the comparison that shows it: a change, a
        // component that arrived, or one the next version drops.
        counterpart = {
          label:
            fate === "changed"
              ? since
                ? `changed since ${version.name}`
                : `changes in ${version.name}`
              : fate === "new"
                ? `new in ${since ? to.name : version.name}`
                : `removed in ${version.name}`,
          fate,
          title: "open the comparison of the two versions here",
          onPeek: (target) => {
            if (other === null) return;
            const [older, newer] = since
              ? [other.commitId, row.commit.commitId]
              : [row.commit.commitId, other.commitId];
            peekLines(
              target,
              `${component.name} between ${since ? version.name : to.name} and ${since ? to.name : version.name}`,
              "",
              component,
              other.files,
              {
                before: { commitId: older, side: "after" },
                after: { commitId: newer, side: "after" },
              },
              path,
            );
          },
          // The interdiff's row is the newer version's commit, or the older
          // one's where the newer version has none.
          onGo: (heading) =>
            compareAt(
              olderVersion,
              newerVersion,
              ref,
              path,
              heading,
              since
                ? row.commit.commitId
                : (other?.commitId ?? row.commit.commitId),
            ),
        };
      }
    }
    // A place that moves code names the place at its other end. The end
    // that removes it is where the code moved from.
    const moved = component.places[ref.place]?.moves;
    const target = moved === undefined ? undefined : component.places[moved];
    const leaves = component.places[ref.place]?.side === "before";
    return {
      at: ref,
      path,
      fate: words,
      sides,
      counterpart,
      move:
        !rest || moved === undefined || target === undefined
          ? null
          : {
              text: `moved ${leaves ? "to" : "from"} ${target.about || target.path}`,
              title: `where this code moved ${leaves ? "to" : "from"}`,
              onGo: () => {
                remember(ref, path);
                goTo(toPlace({ component, place: moved }, target.path));
              },
            },
      message:
        rest && first && mentionedIn(row.commit.description, component)
          ? () => {
              remember(ref, path);
              showMessage(row.key, component.id);
            }
          : null,
      threads:
        rest && first && commentsOn(component.id).length > 0
          ? {
              count: commentsOn(component.id).length,
              onOpen: (target) => {
                const box = target.getBoundingClientRect();
                setPeeked({
                  kind: "threads",
                  component,
                  comments: commentsOn(component.id),
                  versionOf,
                  goTo: (comment) => {
                    const selector = threadAt(comment);
                    return selector === null
                      ? null
                      : () => {
                          remember(ref, path);
                          goTo({ key: null, id: "", path: null, selector });
                        };
                  },
                  x: box.left,
                  y: box.bottom + 6,
                  above: box.top - 6,
                });
              },
            }
          : null,
      places: rest
        ? {
            onStep: (by) => {
              const drawnHeadings = headings().filter(
                (each) =>
                  each.dataset.componentsId === component.id &&
                  each.querySelector(".components-heading__count") !== null &&
                  !each.hasAttribute("data-components-again"),
              );
              const at = drawnHeadings.findIndex(
                (each) =>
                  each.dataset.componentsKey === placeKey(ref) &&
                  each.dataset.path === path,
              );
              const next =
                drawnHeadings[
                  (at + by + drawnHeadings.length) % drawnHeadings.length
                ];
              if (next === undefined) return;
              goTo({
                key: next.dataset.componentsKey ?? null,
                id: component.id,
                path: next.dataset.path ?? null,
                selector: null,
              });
            },
          }
        : null,
      onLeave: leave,
    };
  };

  // Names in the code, and phrases in a message, that link to components.
  const words = useMemo(
    () =>
      new Map(
        components.flatMap((each) =>
          each.words.map((word) => [word, each] as const),
        ),
      ),
    [components],
  );
  const phrases = useMemo(
    () =>
      new Map(
        components.flatMap((each) =>
          each.mentions.map((phrase) => [phrase, each] as const),
        ),
      ),
    [components],
  );
  const firstPlace = (id: string) => {
    for (const row of rows) {
      const drawn = placesOf
        .get(row.key)
        ?.find((each) => each.ref.component.id === id);
      if (drawn !== undefined) return { row, drawn };
    }
    return null;
  };
  /** Goes to a component's first drawn place or, on a comparison of two
   *  versions that leaves it out as unchanged, to it in the newer version.
   *  Null when neither draws it. */
  /** Opens a version compared with its counterpart, at a component only the
   *  counterpart has. */
  const toCounterpart = (row: StackRow, id: string) => {
    const other = counterpartOf(row.commit.commitId);
    if (other === null) return;
    const since = counterparts.direction === "since";
    const [older, newer] = since
      ? [other.version.id, to.id]
      : [to.id, other.version.id];
    props.onCompare(older, newer, since ? row.commit.commitId : other.commitId);
    goTo(
      { key: null, id, path: null, selector: null },
      null,
      comparisonKey(older, newer),
    );
  };
  const reach = (id: string): (() => void) | null => {
    const found = firstPlace(id);
    if (found !== null) {
      return () => goTo(toPlace(found.drawn.ref, found.drawn.path));
    }
    if (from === null) {
      // Only the counterpart version has it: the two compared draw it.
      const row = rows.find((each) =>
        counterpartOf(each.commit.commitId)?.components.some(
          (component) => component.id === id,
        ),
      );
      return row === undefined ? null : () => toCounterpart(row, id);
    }
    if (!components.some((each) => each.id === id)) return null;
    return () => {
      props.onCompare(null, to.id, null);
      goTo(
        { key: null, id, path: null, selector: null },
        null,
        comparisonKey(null, to.id),
      );
    };
  };
  const peekFirst = (target: HTMLElement, component: Component) => {
    const found = firstPlace(component.id);
    if (found === null) return;
    peekLines(
      target,
      `${component.kind} ${component.name}`,
      component.gist,
      component,
      found.row.files,
      rowTrees(found.row),
      found.drawn.path,
    );
  };
  // Links are anchors rather than buttons, so they wrap with the text
  // around them.
  const link = (
    component: Component,
    text: string,
    key: number,
    className: string,
    onGo: () => void,
    data: Record<string, string | number> = {},
  ) => (
    <a
      key={key}
      href={`#components-${ident(component.id)}`}
      className={`${className} components-kind--${component.kind}`}
      {...data}
      onMouseEnter={(event) => peekFirst(event.currentTarget, component)}
      onMouseLeave={leave}
      onClick={(event) => {
        event.preventDefault();
        // A click on a line opens the composer; a link is not that.
        event.stopPropagation();
        onGo();
      }}
    >
      {text}
    </a>
  );
  const wordsIn = (
    text: string,
    line: CodeLine,
    trees: RowTrees,
    file: FileDiff,
  ) => {
    const runs = marked(text, words, true);
    if (runs.every((run) => run.mark === null)) return text;
    return runs.map((run, index) => {
      const component = run.mark;
      if (component === null) return run.text;
      const go = reach(component.id);
      if (go === null) return run.text;
      return link(
        component,
        run.text,
        index,
        "components-word",
        () => {
          const at = placeOfLine(trees, file, line);
          if (at !== null) {
            remember(at, "path" in file ? file.path : file.newPath);
          } else rememberHere();
          go();
        },
        // Names in code are many; tabbing goes through the diff's own
        // stops, and the rail reaches every component.
        { tabIndex: -1 },
      );
    });
  };
  const mentionsIn = (row: StackRow, text: string) => {
    const runs = marked(text, phrases, false);
    if (runs.every((run) => run.mark === null)) return text;
    return runs.map((run, index) => {
      const component = run.mark;
      if (component === null) return run.text;
      const go = reach(component.id);
      if (go === null) return run.text;
      return link(
        component,
        run.text,
        index,
        "components-mention",
        () => {
          rememberMessage(row, component.id);
          go();
        },
        {
          "data-components-message": row.key,
          "data-components-mention": component.id,
          title: `${component.kind} ${component.name}`,
        },
      );
    });
  };

  // The layer reads everything through `live`, so it only has to change
  // when what it draws does. A hover or the reading line moving draws this
  // view again, not the diff under it.
  const live = useRef({ headingParts, placeOfLine, wordsIn, mentionsIn });
  live.current = { headingParts, placeOfLine, wordsIn, mentionsIn };
  const fates = rows
    .map(
      (row) =>
        `${row.key}:${counterpartOf(row.commit.commitId)?.files.status ?? "-"}`,
    )
    .join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: what the layer draws from; the rest it reads through `live`
  const layer = useMemo(
    (): StackLayer => ({
      message: () => null,
      messageWords: (row) => (text) => live.current.mentionsIn(row, text),
      decor: (row) => {
        const places = placesOf.get(row.key);
        if (places === undefined || places.length === 0) return undefined;
        const trees = rowTrees(row);
        return (file) => {
          const path = "path" in file ? file.path : file.newPath;
          return {
            header: null,
            lineClass: (line) => {
              if (line.kind === "context") return null;
              const ref = live.current.placeOfLine(trees, file, line);
              if (ref === null) return null;
              return `components-line components-kind--${ref.component.kind} components-of--${ident(ref.component.id)}`;
            },
            marker: () => null,
            under: () => null,
            above: () => null,
            aside: null,
            over: (line, earlier) => {
              if (line.kind === "context") return null;
              const ref = live.current.placeOfLine(trees, file, line);
              if (ref === null) return null;
              // The run continues the line before it, or resumes after the
              // structural view drew another run between.
              const headed = earlier.some((each) => {
                const was = live.current.placeOfLine(trees, file, each);
                return was !== null && sameRun(was, ref);
              });
              if (headed) return null;
              const drawn = places.find(
                (each) =>
                  placeKey(each.ref) === placeKey(ref) && each.path === path,
              );
              if (drawn === undefined) return null;
              return (
                <Heading
                  {...live.current.headingParts(row, drawn, line.anchor.side)}
                />
              );
            },
            token: (text, line) =>
              live.current.wordsIn(text, line, trees, file),
          };
        };
      },
    }),
    [placesOf, components, split, from?.id, to.id, comments, fates],
  );
  const stack = useMemo(
    () => children(enabled ? layer : undefined),
    [children, enabled, layer],
  );

  // A heading numbers its component's places among the headings each row
  // draws, which a fold, the structural view or a gap opening changes
  // without drawing this view again. A run that a hunk boundary splits is
  // headed again; the repeat leaves the message, threads and steps to the
  // first.
  useEffect(() => {
    const root = body.current;
    if (root === null) return;
    let frame = 0;
    const number = () => {
      frame = 0;
      const seen = new Set<string>();
      const groups = new Map<string, HTMLElement[]>();
      const rowsOf = new Map<Element, number>();
      for (const each of root.querySelectorAll<HTMLElement>(
        "[data-components-key]",
      )) {
        const column = each.closest(".diff-line--before")
          ? "before"
          : each.closest(".diff-line--after")
            ? "after"
            : "one";
        const row = each.closest(".commit-stack__row");
        if (row !== null && !rowsOf.has(row)) rowsOf.set(row, rowsOf.size);
        const where = `${rowsOf.get(row ?? root) ?? -1}|${each.dataset.componentsKey}|${each.dataset.path}`;
        const again = seen.has(`${where}|${column}`);
        seen.add(`${where}|${column}`);
        each.toggleAttribute("data-components-again", again);
        if (again || each.querySelector(".components-heading__count") === null)
          continue;
        const group = `${rowsOf.get(row ?? root) ?? -1}|${each.dataset.componentsId}`;
        groups.set(group, [...(groups.get(group) ?? []), each]);
      }
      for (const group of groups.values()) {
        group.forEach((each, index) => {
          const count = each.querySelector(".components-heading__count");
          const text = `${index + 1} of ${group.length}`;
          if (count !== null && count.textContent !== text) {
            count.textContent = text;
          }
          each
            .querySelector(".components-heading__places")
            ?.toggleAttribute("hidden", group.length < 2);
        });
      }
    };
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(number);
    });
    observer.observe(root, { childList: true, subtree: true });
    number();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // ---- the rail: the current row's components and files ----
  const shown = !enabled
    ? undefined
    : (rows.find((each) => each.key === current) ??
      rows.find((each) => (placesOf.get(each.key)?.length ?? 0) > 0));
  const drawnHere = shown === undefined ? [] : (placesOf.get(shown.key) ?? []);
  const entries: RailEntry[] = [];
  if (shown !== undefined) {
    const listed = [
      ...commitsOf(shown.commit.commitId),
      ...(shown.was === null ? [] : commitsOf(shown.was.commitId)),
      ...(shown.was === null
        ? (counterpartOf(shown.commit.commitId)?.components ?? [])
        : []),
    ];
    const seen = new Set<string>();
    for (const component of listed) {
      if (seen.has(component.id)) continue;
      seen.add(component.id);
      const mine = drawnHere.filter(
        (each) => each.ref.component.id === component.id,
      );
      const theirFates = mine.map((each) => fateOf(shown, each));
      const runs = runStarts(drawnHere).filter(
        (each) => each.ref.component.id === component.id,
      );
      const inCommit = component.commitId === shown.commit.commitId;
      const fate: Fate | null =
        mine.length === 0
          ? shown.was !== null
            ? "unchanged"
            : inCommit
              ? null
              : // Only the counterpart has it: the newer version adds it, or
                // the older one had it.
                counterparts.direction === "until"
                ? "new"
                : "removed"
          : theirFates.includes("new")
            ? "new"
            : theirFates.includes("removed")
              ? "removed"
              : theirFates.includes("changed")
                ? "changed"
                : theirFates.every((each) => each === "unchanged")
                  ? "unchanged"
                  : null;
      entries.push({
        component,
        fate,
        drawn: mine.length > 0,
        places: runs.length,
        threads: commentsOn(component.id).length,
      });
    }
  }
  const files =
    shown?.files.status === "ready"
      ? shown.files.data.map((file) => ({
          path: "path" in file ? file.path : file.newPath,
          shares: fileShares(components, rowTrees(shown), file),
        }))
      : [];

  // Off, the rail's slots stay empty rather than go, so the stack keeps its
  // place among the children and every file keeps its state.
  return (
    <>
      <div className="components-body" ref={body}>
        {enabled && reading !== null && (
          // The place being read takes a solid bar. A rule rather than a
          // class on its lines, so moving it never draws the diff again.
          <style>{`.diff-file[data-path="${CSS.escape(reading.path)}"] .components-of--${ident(reading.id)} { box-shadow: inset 3px 0 0 var(--component); }`}</style>
        )}
        {enabled && (
          <aside
            className={`components-rail${railSize === null ? "" : " pane--sized"}${railOpen ? "" : " components-rail--closed"}`}
            style={paneSize(railSize)}
          >
            {/* Only a narrow screen draws this; there the rail sits above
                the diff and starts closed, so the review bar stays in view. */}
            <button
              type="button"
              className="components-rail__toggle"
              aria-expanded={railOpen}
              onClick={() => setRailOpen(!railOpen)}
            >
              {railOpen ? "▾" : "▸"} Components{" "}
              {entries.length > 0 && <small>{entries.length}</small>}
            </button>
            <Rail
              loading={shown === undefined || shown.files.status !== "ready"}
              comparing={
                from === null
                  ? `in ${to.name}`
                  : `between ${from.name} and ${to.name}`
              }
              entries={entries}
              files={files}
              reading={reading}
              onMessage={
                shown !== undefined &&
                components.some(
                  (each) =>
                    each.commitId === shown.commit.commitId &&
                    mentionedIn(shown.commit.description, each),
                )
                  ? () => {
                      rememberHere();
                      showMessage(shown.key, null);
                    }
                  : null
              }
              onGo={(entry) => {
                const drawn = drawnHere.find(
                  (each) => each.ref.component.id === entry.component.id,
                );
                if (drawn !== undefined) {
                  rememberHere();
                  goTo(toPlace(drawn.ref, drawn.path));
                } else if (from === null && shown !== undefined) {
                  rememberHere();
                  toCounterpart(shown, entry.component.id);
                } else if (from !== null) {
                  // Unchanged between versions: read it in the newer one.
                  rememberHere();
                  props.onCompare(null, to.id, null);
                  goTo(
                    {
                      key: null,
                      id: entry.component.id,
                      path: null,
                      selector: null,
                    },
                    null,
                    comparisonKey(null, to.id),
                  );
                }
              }}
              onGoShare={(path, share) => {
                if (share.first === null) return;
                rememberHere();
                goTo(toPlace(share.first, path));
              }}
            />
          </aside>
        )}
        {enabled && (
          <Splitter
            pane="components-rail"
            size={railSize}
            onResize={onRailResize}
            label="resize the components rail"
          />
        )}
        <div
          className={`components-main${enabled && trail.length > 0 ? " components-main--trail" : ""}`}
        >
          {stack}
        </div>
      </div>
      {enabled && (
        <Trail
          labels={trail.map((each) => each.label)}
          onBack={back}
          onForget={() => setTrail([])}
        />
      )}
      {enabled && shownPeek !== null && (
        <Peek
          peeked={shownPeek}
          components={components}
          onLeave={() =>
            setPeeked((now) => (now?.kind === "lines" ? null : now))
          }
          onClose={() => setPeeked(null)}
        />
      )}
    </>
  );
}

function flash(element: HTMLElement) {
  element.classList.remove("components-flash");
  void element.offsetWidth;
  element.classList.add("components-flash");
}
```

### Heading

Side by side, a place's heading sits in each column it changes. Each carries
its own side's way to that version, and the after column carries the rest,
so one heading never repeats the other.

```tsx
//| id: frontend-view-components-heading
//| file: src/frontend/views/Components/Heading.tsx
import type { MouseEvent, ReactNode } from "react";
import type { Fate, PlaceRef } from "../../model/components";
import { CommentIcon, MessageIcon, SwapIcon } from "./icons";

/** A way to the same place in another comparison, peeked at on hover. */
export interface Switch {
  label: string;
  /** How the place fares there, which the switch is coloured by. */
  fate?: Fate;
  title: string;
  onPeek: (target: HTMLElement) => void;
  onGo: (heading: HTMLElement | null) => void;
}

/** What a heading says and offers. Side by side, each column's heading
 *  carries its own side and the after column's carries the rest. */
export interface HeadingParts {
  at: PlaceRef;
  path: string;
  /** The words a fate gets when it is not a way to another comparison. */
  fate: { fate: Fate; text: string } | null;
  /** The versions this place can be read in, each its own diff. */
  sides: Switch[];
  /** The comparison of this place with the version it is held against. */
  counterpart: Switch | null;
  move: { text: string; title: string; onGo: () => void } | null;
  message: (() => void) | null;
  threads: { count: number; onOpen: (target: HTMLElement) => void } | null;
  /** Steps through the component's places. The page numbers them from the
   *  headings it draws, which the structural view and folds change. */
  places: { onStep: (by: 1 | -1) => void } | null;
  onLeave: () => void;
}

export function Heading({
  at,
  path,
  fate,
  sides,
  counterpart,
  move,
  message,
  threads,
  places,
  onLeave,
}: HeadingParts) {
  const { component, place } = at;
  const heading = (event: MouseEvent<HTMLElement>) =>
    event.currentTarget.closest<HTMLElement>("[data-components-key]");
  const peekable = (each: Switch, children: ReactNode, className: string) => (
    <button
      type="button"
      key={each.label}
      className={className}
      title={each.title}
      onMouseEnter={(event) => each.onPeek(event.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(event) => each.onGo(heading(event))}
    >
      {children}
    </button>
  );
  return (
    <div
      className={`components-heading components-kind--${component.kind}${component.role === "wires" ? " components-heading--minor" : ""}`}
      data-components-key={`${component.commitId}:${component.id}/${place}`}
      data-components-id={component.id}
      data-path={path}
    >
      <span className="components-heading__kind">{component.kind}</span>
      <span className="components-heading__name">{component.name}</span>
      <span className="components-heading__about">
        {component.places[place]?.about ?? ""}
      </span>
      <span className="components-heading__right">
        {move !== null && (
          <button
            type="button"
            className="components-chip"
            title={move.title}
            onClick={move.onGo}
          >
            {move.text}
          </button>
        )}
        {message !== null && (
          <button
            type="button"
            className="components-chip components-heading__message"
            title="where the commit message describes this"
            onClick={message}
          >
            <MessageIcon /> message
          </button>
        )}
        {fate !== null && (
          <span className={`components-fate components-fate--${fate.fate}`}>
            {fate.text}
          </span>
        )}
        {sides.length > 0 && (
          <span
            className="components-switch"
            title="this place in one version's own diff, at this height"
          >
            <SwapIcon />
            {sides.map((side) =>
              peekable(
                side,
                side.label,
                "components-chip components-switch__side",
              ),
            )}
          </span>
        )}
        {counterpart !== null &&
          peekable(
            counterpart,
            <>
              <SwapIcon />
              {counterpart.label}
            </>,
            `components-fate components-fate--${counterpart.fate ?? "changed"} components-fate--switch`,
          )}
        {threads !== null && (
          <button
            type="button"
            className="components-chip components-heading__threads"
            title="the threads on this component, on any version"
            onClick={(event) => threads.onOpen(event.currentTarget)}
          >
            <CommentIcon /> {threads.count}
          </button>
        )}
        {places !== null && (
          <span className="components-heading__places">
            <button
              type="button"
              className="components-chip"
              aria-label="previous place"
              onClick={() => places.onStep(-1)}
            >
              ‹
            </button>
            <span className="components-heading__count" />
            <button
              type="button"
              className="components-chip"
              aria-label="next place"
              onClick={() => places.onStep(1)}
            >
              ›
            </button>
          </span>
        )}
      </span>
    </div>
  );
}
```

### Rail

The rail is the current commit at a glance: its components by role, each
marked with how it fares in the comparison on screen, then each file's
changed lines shared out by component. A bar's width is a component's share
of the file's changed lines, not where they fall, since the diff beside it
already shows where.

```tsx
//| id: frontend-view-components-rail
//| file: src/frontend/views/Components/Rail.tsx
import type {
  Component,
  ComponentRole,
  Fate,
  FileShare,
} from "../../model/components";
import { CommentIcon, MessageIcon } from "./icons";

/** One component as the rail lists it. */
export interface RailEntry {
  component: Component;
  /** How it fares in the comparison on screen; null when it says nothing. */
  fate: Fate | null;
  /** Whether the comparison on screen draws any of it. */
  drawn: boolean;
  places: number;
  threads: number;
}

/** One file of the current row, and its changed lines by component. */
export interface RailFile {
  path: string;
  shares: FileShare[];
}

const ROLES: [ComponentRole, string][] = [
  ["implements", "implements"],
  ["refactors", "refactors"],
  ["wires", "wires through"],
  ["tests", "tests"],
];

// The paired graph's marks: + added, − dropped, ~ changed.
const MARKS: Record<Fate, string> = {
  new: "+",
  removed: "−",
  changed: "~",
  unchanged: "=",
};

export function Rail({
  loading,
  comparing,
  entries,
  files,
  reading,
  onMessage,
  onGo,
  onGoShare,
}: {
  /** The current row's diff has not landed yet. */
  loading: boolean;
  comparing: string;
  entries: RailEntry[];
  files: RailFile[];
  /** The component and file under the reading line. */
  reading: { id: string; path: string } | null;
  onMessage: (() => void) | null;
  onGo: (entry: RailEntry) => void;
  onGoShare: (path: string, share: FileShare) => void;
}) {
  if (loading) {
    return <p className="components-rail__wait">Loading components...</p>;
  }
  return (
    <>
      {onMessage !== null && (
        <button
          type="button"
          className="components-rail__message"
          title="the commit message, which names the components it introduces"
          onClick={onMessage}
        >
          <MessageIcon /> commit message
        </button>
      )}
      <h3 className="components-rail__head">
        Components <small>{comparing}</small>
      </h3>
      <ul className="components-toc">
        {ROLES.flatMap(([role, label]) => {
          const own = entries.filter((entry) => entry.component.role === role);
          if (own.length === 0) return [];
          return [
            <li key={role} className="components-toc__group">
              {label}
            </li>,
            ...own.map((entry) => {
              const { component } = entry;
              const here = reading?.id === component.id;
              return (
                <li
                  key={component.id}
                  className={`components-kind--${component.kind}${here ? " components-toc--here" : ""}${entry.drawn ? "" : " components-toc--off"}`}
                >
                  <button
                    type="button"
                    className="components-toc__entry"
                    onClick={() => onGo(entry)}
                  >
                    <span
                      className={`components-toc__fate components-fate--${entry.fate ?? "none"}`}
                      title={entry.fate ?? ""}
                    >
                      {entry.fate === null ? "" : MARKS[entry.fate]}
                    </span>
                    <span className="components-heading__kind">
                      {component.kind}
                    </span>
                    <span className="components-toc__name">
                      {component.name}
                    </span>
                    {entry.threads > 0 && (
                      <span
                        className="components-toc__count"
                        title={`${entry.threads} thread${entry.threads === 1 ? "" : "s"}`}
                      >
                        <CommentIcon /> {entry.threads}
                      </span>
                    )}
                    {entry.places > 1 && (
                      <span
                        className="components-toc__count"
                        title={`${entry.places} places`}
                      >
                        ×{entry.places}
                      </span>
                    )}
                  </button>
                </li>
              );
            }),
          ];
        })}
      </ul>
      <h3 className="components-rail__head">
        Files <small>each bar: its changed lines, by component</small>
      </h3>
      {files.map((file) => {
        const total = file.shares.reduce((sum, share) => sum + share.lines, 0);
        return (
          <div
            key={file.path}
            className={`components-file${reading?.path === file.path ? " components-file--here" : ""}`}
          >
            <span className="components-file__path">
              <span className="components-file__total">{total}</span>
              {file.path.replace(/^src\/(frontend\/|backend\/)?/, "")}
            </span>
            <span className="components-file__strip">
              {file.shares.map((share) => {
                const component = share.first?.component;
                const lit =
                  component !== undefined &&
                  reading?.id === component.id &&
                  reading.path === file.path;
                return (
                  <button
                    type="button"
                    key={share.id ?? ""}
                    style={{ flexGrow: share.lines }}
                    className={
                      component === undefined
                        ? "components-file__unowned"
                        : `components-kind--${component.kind}${lit ? " components-file--lit" : ""}`
                    }
                    title={`${component === undefined ? "no component" : `${component.kind} ${component.name}`}: ${share.lines} of ${total} changed lines (${Math.round((100 * share.lines) / total)}%)`}
                    onClick={() => onGoShare(file.path, share)}
                  />
                );
              })}
            </span>
          </div>
        );
      })}
    </>
  );
}
```

### Peek

```tsx
//| id: frontend-view-components-peek
//| file: src/frontend/views/Components/Peek.tsx
import type { ReactNode } from "react";
import type { AsyncState } from "../../model/asyncState";
import { type Component, placeAt, type RowTrees } from "../../model/components";
import type { FileDiff } from "../../model/diff";
import { readPatch } from "../../model/patch";
import type { Comment } from "../../model/review";

/** What a peek shows: a component's lines in some diff, or its threads. */
export type Peeked =
  | {
      kind: "lines";
      title: string;
      note: string;
      component: Component;
      files: AsyncState<FileDiff[]>;
      trees: RowTrees;
      path: string;
      x: number;
      /** Just below the trigger, and just above it. */
      y: number;
      above: number;
    }
  | {
      kind: "threads";
      component: Component;
      comments: Comment[];
      versionOf: (commitId: string) => string;
      /** Goes to where a thread sits, or null when this comparison does not
       *  draw its line. */
      goTo: (comment: Comment) => (() => void) | null;
      x: number;
      /** Just below the trigger, and just above it. */
      y: number;
      above: number;
    };

export function Peek({
  peeked,
  components,
  onLeave,
  onClose,
}: {
  peeked: Peeked;
  components: Component[];
  onLeave: () => void;
  onClose: () => void;
}) {
  const width = 600;
  // Below the trigger, unless there is more room above it; either way no
  // taller than the room, so it never covers what was pointed at.
  const below = innerHeight - peeked.y - 8;
  const above = peeked.above - 8;
  const down = below >= Math.min(above, innerHeight * 0.6);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: leaving a peek closes it, as pointing at its trigger opened it
    <div
      className={`components-peek components-kind--${peeked.component.kind}`}
      style={{
        left: Math.max(8, Math.min(peeked.x - 40, innerWidth - width - 20)),
        ...(down
          ? { top: peeked.y, maxHeight: `min(60vh, ${below}px)` }
          : {
              bottom: innerHeight - peeked.above,
              maxHeight: `min(60vh, ${above}px)`,
            }),
      }}
      onMouseLeave={onLeave}
    >
      {peeked.kind === "lines" ? (
        <>
          <div className="components-peek__head">
            <b>{peeked.title}</b>
          </div>
          <div className="components-peek__body">
            {peeked.files.status === "ready" ? (
              <Lines
                components={components}
                files={peeked.files.data}
                trees={peeked.trees}
                id={peeked.component.id}
                path={peeked.path}
              />
            ) : (
              <p className="components-peek__wait">
                {peeked.files.status === "error"
                  ? peeked.files.message
                  : "Loading..."}
              </p>
            )}
          </div>
          {peeked.note !== "" && (
            <div className="components-peek__foot">{peeked.note}</div>
          )}
        </>
      ) : (
        <>
          <div className="components-peek__head">
            <b>{peeked.component.name}</b>
            <span>
              {peeked.comments.length} thread
              {peeked.comments.length === 1 ? "" : "s"}, on any version
            </span>
            <button type="button" className="components-chip" onClick={onClose}>
              close ✕
            </button>
          </div>
          <div className="components-peek__body">
            {peeked.comments.map((comment) => (
              <div key={comment.id} className="components-thread">
                <ThreadHead
                  comment={comment}
                  version={peeked.versionOf(comment.commitId)}
                  onGo={peeked.goTo(comment)}
                />
                {[
                  {
                    id: comment.id,
                    author: comment.author,
                    body: comment.body,
                  },
                  ...comment.replies,
                ].map((message) => (
                  <div key={message.id} className="components-thread__message">
                    <b
                      className={
                        message.author === "reader"
                          ? undefined
                          : "components-thread__other"
                      }
                    >
                      {message.author === "reader" ? "you" : message.author}
                    </b>{" "}
                    {message.body}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Where a thread sits, as a link to it when this comparison draws it. */
function ThreadHead({
  comment,
  version,
  onGo,
}: {
  comment: Comment;
  version: string;
  onGo: (() => void) | null;
}) {
  const where =
    comment.kind === "line"
      ? `${comment.path.split("/").pop()}:${comment.line}`
      : "";
  return (
    <div className="components-thread__head">
      {onGo === null ? (
        where
      ) : (
        <button type="button" className="components-chip" onClick={onGo}>
          {where}
        </button>
      )}{" "}
      · {version} · {comment.resolved ? "resolved" : "open"}
    </div>
  );
}

/** The runs of a component's lines in one file of a diff, with a line of
 *  context either side, the way the diff itself draws them. */
function Lines({
  components,
  files,
  trees,
  id,
  path,
}: {
  components: Component[];
  files: FileDiff[];
  trees: RowTrees;
  id: string;
  path: string;
}) {
  const rows: ReactNode[] = [];
  for (const file of files) {
    const before = "path" in file ? file.path : file.oldPath;
    const after = "path" in file ? file.path : file.newPath;
    if (after !== path && before !== path) continue;
    for (const hunk of readPatch(file.patch).hunks) {
      const lines = hunk.lines.filter((line) => line.kind !== "note");
      const inside = lines.map((line) => {
        const ref =
          line.kind === "added"
            ? placeAt(components, trees.after, after, line.newLine)
            : line.kind === "removed"
              ? placeAt(components, trees.before, before, line.oldLine)
              : null;
        return ref?.component.id === id;
      });
      const first = inside.indexOf(true);
      if (first === -1) continue;
      const last = inside.lastIndexOf(true);
      if (rows.length > 0) {
        rows.push(
          <div key={`gap-${rows.length}`} className="components-lines__gap">
            ⋯
          </div>,
        );
      }
      for (const line of lines.slice(Math.max(0, first - 1), last + 2)) {
        rows.push(
          <div
            key={rows.length}
            className={`components-lines__line components-lines__line--${line.kind}`}
          >
            <span className="components-lines__number">
              {"oldLine" in line ? (line.oldLine ?? "") : ""}
            </span>
            <span className="components-lines__number">
              {"newLine" in line ? line.newLine : ""}
            </span>
            <span className="components-lines__sign">
              {line.kind === "added"
                ? "+"
                : line.kind === "removed"
                  ? "-"
                  : " "}
            </span>
            <span>{line.code}</span>
          </div>,
        );
      }
    }
  }
  return rows.length === 0 ? (
    <p className="components-peek__wait">Nothing of it in that diff.</p>
  ) : (
    <pre className="components-lines">{rows}</pre>
  );
}
```

### Trail

```tsx
//| id: frontend-view-components-trail
//| file: src/frontend/views/Components/Trail.tsx
/** The places the reader came from, newest last, each one a way back. */
export function Trail({
  labels,
  onBack,
  onForget,
}: {
  labels: string[];
  onBack: (index: number) => void;
  onForget: () => void;
}) {
  if (labels.length === 0) return null;
  const shown = labels.slice(-4);
  const skipped = labels.length - shown.length;
  return (
    <div className="components-trail">
      <span className="components-trail__label">came from</span>
      {shown.map((label, index) => {
        const at = skipped + index;
        return (
          <button
            type="button"
            key={at}
            className={
              at === labels.length - 1 ? "components-trail--back" : undefined
            }
            onClick={() => onBack(at)}
          >
            {label}
          </button>
        );
      })}
      <button type="button" onClick={onForget} aria-label="forget the trail">
        ✕
      </button>
    </div>
  );
}
```

```tsx
//| id: frontend-view-components-icons
//| file: src/frontend/views/Components/icons.tsx
/** Line icons drawn in the text's colour, at its size. */
export function CommentIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  );
}

export function MessageIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10M3 7h10M3 10h6" />
    </svg>
  );
}

export function SwapIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 5.5h9.5l-2.5-2.5M13 10.5h-9.5l2.5 2.5" />
    </svg>
  );
}
```

## The switch

A series with a map reads with it laid over by default, and the switch in
the comparison bar takes it off. Whether it is on is a [setting](settings.md),
so a phone and a laptop keep their own.

```tsx
//| id: frontend-view-components-switch
//| file: src/frontend/views/ComponentsSwitch.tsx
import type { ComponentsShown } from "../model/settings";

/** Lays a series' components over its diff, or takes them off. A switch,
 *  so it reads as a way of reading rather than one more link in the bar. */
export function ComponentsSwitch({
  shown,
  onChange,
}: {
  shown: ComponentsShown;
  onChange: (shown: ComponentsShown) => void;
}) {
  const on = shown === "shown";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="components-switch-mode"
      title="label each part of the diff with the component it is"
      onClick={() => onChange(on ? "hidden" : "shown")}
    >
      <span className="components-switch-mode__track" aria-hidden="true" />
      Components
    </button>
  );
}
```

## Styling

```css
/*| id: design-components
@layer components {
  /* A kind takes one of the graph's lane colours, so the dark theme has a
   * readable one for free. Wiring, refactors and any kind not named here stay
   * grey: they are the parts a reader most often skims. */
  [class*="components-kind--"] {
    --component: var(--text-faint);
  }
  .components-kind--schema,
  .components-kind--field {
    --component: var(--graph-lane-0);
  }
  .components-kind--command {
    --component: var(--graph-lane-4);
  }
  .components-kind--action {
    --component: var(--graph-lane-1);
  }
  .components-kind--view {
    --component: var(--graph-lane-2);
  }
  .components-kind--styles {
    --component: var(--graph-lane-3);
  }
  .components-kind--helper {
    --component: var(--graph-lane-5);
  }
  .components-kind--test {
    --component: var(--graph-lane-6);
  }

  .components-switch-mode {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    padding: 2px var(--space-3) 2px var(--space-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .components-switch-mode:hover {
    border-color: var(--text-muted);
  }
  .components-switch-mode__track {
    position: relative;
    width: 24px;
    height: 13px;
    border-radius: 7px;
    background: var(--border);
  }
  .components-switch-mode__track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--surface);
  }
  .components-switch-mode[aria-checked="true"] .components-switch-mode__track {
    background: var(--accent);
  }
  .components-switch-mode[aria-checked="true"]
    .components-switch-mode__track::after {
    left: 13px;
  }

  .components-body {
    display: flex;
    align-items: flex-start;
  }
  .components-main {
    flex: 1;
    min-width: 0;
  }
  .components-body > .splitter {
    align-self: stretch;
  }
  /* The rail's edge is a thin line; give a pointer more to catch. */
  .components-body > .splitter::before {
    inset: 0 -6px;
  }
  .components-rail__toggle {
    display: none;
  }
  .components-rail {
    flex: none;
    position: sticky;
    top: 0;
    width: var(--pane-size, 24em);
    max-height: 100vh;
    overflow: auto;
    padding: var(--space-4);
    background: var(--surface-sunken);
    border-right: 1px solid var(--border);
    font-size: var(--text-size-small);
  }
  .components-rail__head {
    margin: var(--space-4) var(--space-2) var(--space-2);
    font-size: var(--text-size-small);
    font-weight: normal;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .components-rail__head small {
    text-transform: none;
    color: var(--text-faint);
  }
  .components-rail__message {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .components-rail__message:hover {
    border-color: var(--text-muted);
  }
  .components-toc {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .components-toc__group {
    padding: var(--space-2) var(--space-2) 0;
    color: var(--text-faint);
  }
  .components-toc__entry {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    width: 100%;
    padding: 1px var(--space-2);
    border: 0;
    border-left: 2px solid transparent;
    border-radius: 3px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .components-toc__entry:hover {
    background: var(--surface-selected);
  }
  .components-toc--here > .components-toc__entry {
    border-left-color: var(--component);
    background: var(--surface);
    font-weight: 600;
  }
  .components-toc--off > .components-toc__entry {
    color: var(--text-faint);
  }
  .components-toc__name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .components-toc__fate {
    flex: none;
    width: 1ch;
    text-align: center;
    font-weight: 600;
    color: var(--text-faint);
  }
  .components-toc__count {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .components-file {
    padding: 2px var(--space-2) var(--space-2);
  }
  .components-file__path {
    display: block;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .components-file--here .components-file__path {
    color: var(--text);
    font-weight: 600;
  }
  .components-file__total {
    float: right;
    margin-left: var(--space-2);
    color: var(--text-faint);
  }
  .components-file__strip {
    display: flex;
    gap: 1px;
    height: 6px;
    margin-top: 2px;
    overflow: hidden;
    border-radius: 2px;
  }
  .components-file__strip button {
    min-width: 2px;
    padding: 0;
    border: 0;
    background: color-mix(in srgb, var(--component) 65%, var(--surface));
    cursor: pointer;
  }
  /* Hatched, so lines no component owns never read as a grey component. */
  .components-file__strip .components-file__unowned {
    background: repeating-linear-gradient(
      -45deg,
      var(--text-ghost) 0 1px,
      transparent 1px 4px
    );
    outline: 1px solid var(--border-subtle);
    outline-offset: -1px;
  }
  .components-file__strip .components-file--lit {
    background: var(--component);
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--text) 40%, transparent);
  }

  /* As quiet as a hunk header: it names a run of lines, it is not one. */
  .components-heading {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    padding: 1px var(--space-3) 0 calc(var(--space-3) + 2px);
    border-top: 1px solid var(--border-subtle);
    border-left: 3px solid var(--component);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--text-size-small);
    white-space: nowrap;
  }
  /* A column of a side-by-side diff is narrow; its controls wrap rather
   * than widen it. */
  :where(.diff-file__patch--split) .components-heading,
  :where(.diff-file__patch--split) .components-heading__right {
    flex-wrap: wrap;
  }
  /* A run a hunk boundary splits is headed again, without the parts its
   * first heading already offers. */
  .components-heading[data-components-again]
  :is(
    .components-heading__message,
    .components-heading__threads,
    .components-heading__places
  ) {
    display: none;
  }
  /* The trail is fixed low on screen; the diff's end scrolls clear of it. */
  .components-main--trail {
    padding-bottom: 20vh;
  }
  .diff-line--over {
    padding: 0;
  }
  .diff-file__patch--split > .diff-line--over:empty {
    border-top: 1px solid var(--border-subtle);
  }
  .components-heading__kind {
    color: var(--component);
  }
  .components-heading__name {
    font-weight: 600;
  }
  .components-heading--minor .components-heading__name {
    font-weight: normal;
    color: var(--text-muted);
  }
  .components-heading__about {
    min-width: 0;
    overflow: hidden;
    color: var(--text-faint);
    text-overflow: ellipsis;
  }
  .components-heading__right {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin-left: auto;
    color: var(--text-faint);
  }
  .components-heading__places {
    display: flex;
    gap: 2px;
    align-items: baseline;
  }
  /* A component the page draws once has nowhere to step to. */
  .components-heading__places[hidden] {
    display: none;
  }
  .components-chip,
  .components-fate {
    padding: 0 var(--space-1);
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--text-faint);
    font: inherit;
    white-space: nowrap;
  }
  button.components-chip,
  button.components-fate {
    cursor: pointer;
  }
  button.components-chip:hover,
  button.components-fate:hover {
    background: var(--surface-selected);
    color: var(--text);
  }
  .components-fate--changed {
    color: var(--review-stale);
  }
  .components-fate--new {
    color: var(--diff-added);
  }
  .components-fate--removed {
    color: var(--diff-removed);
  }
  /* The ways to another comparison are bordered, so they read as controls
   * among the heading's words. */
  .components-switch {
    display: inline-flex;
    gap: 1px;
    align-items: center;
    padding-left: var(--space-1);
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-sunken);
    color: var(--text-muted);
  }
  .components-switch .components-switch__side {
    padding: 0 var(--space-2);
    border-left: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-weight: 600;
  }
  .components-fate--switch {
    display: inline-flex;
    gap: 3px;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--review-stale) 40%, transparent);
  }
  .components-icon {
    width: 1.15em;
    height: 1.15em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    vertical-align: -0.2em;
  }
  .components-flash {
    animation: components-flash 1.4s ease-out;
  }
  @keyframes components-flash {
    from {
      background: color-mix(in srgb, var(--component) 25%, var(--surface));
    }
  }

  .diff-line.components-line {
    box-shadow: inset 3px 0 0
      color-mix(in srgb, var(--component) 35%, transparent);
  }
  /* Words and phrases are links that look like the text they are in. */
  .components-word,
  .components-mention {
    color: inherit;
    text-decoration: underline dotted
      color-mix(in srgb, var(--component) 80%, transparent);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .components-mention {
    text-decoration-thickness: 1.5px;
  }
  .components-word:hover,
  .components-mention:hover {
    background: color-mix(in srgb, var(--component) 12%, transparent);
    text-decoration-style: solid;
  }

  .components-peek {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: 600px;
    max-width: calc(100vw - 16px);
    max-height: 60vh;
    border: 1px solid var(--border);
    border-top: 3px solid var(--component);
    border-radius: 6px;
    background: var(--surface-raised);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
    font-size: var(--text-size-small);
  }
  .components-peek__head {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
  }
  .components-peek__head .components-chip {
    margin-left: auto;
  }
  .components-peek__body {
    overflow: auto;
  }
  .components-peek__foot {
    padding: var(--space-1) var(--space-3);
    border-top: 1px solid var(--border-subtle);
    color: var(--text-faint);
  }
  .components-peek__wait {
    margin: var(--space-3);
    color: var(--text-faint);
  }
  .components-lines {
    margin: 0;
    font-size: var(--text-size-small);
  }
  .components-lines__line {
    display: flex;
    white-space: pre;
  }
  .components-lines__line--added {
    background: var(--diff-added-surface);
  }
  .components-lines__line--removed {
    background: var(--diff-removed-surface);
  }
  .components-lines__number {
    flex: none;
    width: 3.5em;
    padding-right: var(--space-2);
    color: var(--text-ghost);
    text-align: right;
  }
  .components-lines__sign {
    flex: none;
    width: 1.5em;
    color: var(--text-faint);
  }
  .components-lines__gap {
    padding-left: 7em;
    color: var(--text-ghost);
  }
  .components-thread {
    margin: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .components-thread__head {
    padding: 2px var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-faint);
  }
  .components-thread__message {
    padding: var(--space-1) var(--space-3);
  }
  .components-thread__other {
    color: var(--graph-lane-4);
  }

  /* The way back sits low in the reader's view, in the accent colour, so it
   * is found without being looked for. */
  .components-trail {
    box-sizing: border-box;
    position: fixed;
    bottom: 8vh;
    left: 50%;
    z-index: 40;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    max-width: calc(100vw - 32px);
    padding: 12px 14px 12px 24px;
    border: 2px solid var(--accent);
    border-radius: 32px;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-raised));
    box-shadow: 0 4px 18px rgb(0 0 0 / 0.18);
    font-size: 15px;
    transform: translateX(-50%);
  }
  .components-rail__wait {
    margin: var(--space-2);
    color: var(--text-faint);
  }
  .components-trail__label {
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }
  .components-trail button {
    min-width: 0;
    max-width: 30em;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 6px 16px;
    border: 0;
    border-radius: 14px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .components-trail button:hover {
    background: var(--surface-selected);
  }
  .components-trail .components-trail--back {
    background: var(--accent);
    color: var(--text-inverse);
  }
}
```

```css
/*| id: design-components
@layer components-narrow {
  @media (max-width: 1000px) {
    .components-body {
      flex-direction: column;
      align-items: stretch;
    }
    .components-body > .splitter {
      display: none;
    }
    .components-rail {
      position: static;
      width: auto;
      max-height: 40vh;
      padding: var(--space-2) var(--space-4);
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .components-rail__toggle {
      display: block;
      width: 100%;
      padding: var(--space-2) 0;
      border: 0;
      background: none;
      color: var(--text-muted);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .components-rail--closed > :not(.components-rail__toggle) {
      display: none;
    }
    .components-heading {
      flex-wrap: wrap;
      white-space: normal;
    }
    .components-heading__right {
      flex-wrap: wrap;
      margin-left: 0;
    }
    /* A finger needs more than the text's height to hit. */
    .components-heading button {
      padding: 4px 8px;
    }
    /* The trail keeps its newest step and its close button on screen. */
    .components-trail {
      max-width: calc(100vw - 16px);
      padding: 8px 8px 8px 14px;
      font-size: 14px;
    }
    .components-trail button {
      padding: 6px 10px;
    }
    .components-trail button:not(:nth-last-child(-n + 2)) {
      display: none;
    }
    .components-trail button:last-child {
      flex: none;
    }
  }
}
```

## Tests

```ts
//| id: frontend-model-components-test
//| file: src/frontend/model/components.test.ts
import { describe, expect, test } from "bun:test";
import {
  type Component,
  type ComponentMap,
  componentsTo,
  counterpartFate,
  drawnPlaces,
  fileShares,
  interdiffFate,
  marked,
  mentionedIn,
  placeAt,
  placeKey,
  rowTrees,
  runStarts,
  sameRun,
  withComponents,
} from "./components";
import type { FileDiff } from "./diff";

function component(id: string, commitId = "c1"): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: [{ path: "a.ts", side: "after", start: 1, about: "" }],
  };
}

function map(version: string, ids: string[]): ComponentMap {
  return {
    series: "local:r",
    version,
    author: "claude",
    writtenAt: "t",
    components: ids.map((id) => component(id)),
  };
}

describe("component maps", () => {
  test("keeps one map to each version, the newest written", () => {
    // arrange
    const maps = withComponents([map("1", ["a"])], map("2", ["a"]));

    // act
    const rewritten = withComponents(maps, map("1", ["b"]));

    // assert
    expect(rewritten).toHaveLength(2);
    expect(componentsTo(rewritten, "local:r", "1")?.components[0]?.id).toBe(
      "b",
    );
    expect(componentsTo(rewritten, "local:r", "3")).toBeUndefined();
  });
});

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
-four
+FOUR
`;

function file(patch = PATCH): FileDiff {
  return {
    status: "modified",
    path: "a.ts",
    binary: false,
    oldBlob: "1111111",
    newBlob: "2222222",
    patch,
    structural: { kind: "unavailable", reason: "test" },
  };
}

/** `c2` renames two in one component and four in another; `c1` is the
 *  version before it, which only had the first. */
const RENAME: Component = {
  ...component("rename", "c2"),
  places: [
    { path: "a.ts", side: "before", start: 2, about: "old" },
    { path: "a.ts", side: "after", start: 2, about: "new" },
  ],
};
const FOUR: Component = {
  ...component("four", "c2"),
  places: [{ path: "a.ts", side: "after", start: 4, about: "" }],
};
const OLDER: Component = {
  ...component("rename", "c1"),
  places: [{ path: "a.ts", side: "after", start: 2, about: "" }],
};
const ALL = [RENAME, FOUR, OLDER];

describe("reading a row", () => {
  test("finds a line's place in the tree each side of a row counts", () => {
    // arrange
    const own = rowTrees({ commit: { commitId: "c2" }, was: null });
    const between = rowTrees({
      commit: { commitId: "c2" },
      was: { commitId: "c1" },
    });

    // act
    const removed = placeAt(ALL, own.before, "a.ts", 2);
    const older = placeAt(ALL, between.before, "a.ts", 2);

    // assert
    expect(removed).toEqual({ component: RENAME, place: 0 });
    expect(older).toEqual({ component: OLDER, place: 0 });
    expect(placeAt(ALL, own.after, "a.ts", 3)).toBeNull();
  });

  test("lists each place a diff changes once, in the order it draws them", () => {
    // arrange
    const trees = rowTrees({ commit: { commitId: "c2" }, was: null });

    // act
    const drawn = drawnPlaces(ALL, trees, [file()]);

    // assert
    expect(
      drawn.map(({ ref, added, removed }) => [placeKey(ref), added, removed]),
    ).toEqual([
      ["c2:rename/0", 0, 1],
      ["c2:rename/1", 1, 0],
      ["c2:four/0", 1, 0],
    ]);
  });

  test("shares a file's changed lines out by component, unowned last", () => {
    // arrange
    const trees = rowTrees({ commit: { commitId: "c2" }, was: null });

    // act
    const shares = fileShares([RENAME, OLDER], trees, file());

    // assert
    expect(shares.map((share) => [share.id, share.lines])).toEqual([
      ["rename", 2],
      [null, 2],
    ]);
  });
});

describe("runs", () => {
  test("reads an interdiff's two versions of one component as one run", () => {
    // arrange
    const older = { component: OLDER, place: 0 };
    const newer = { component: RENAME, place: 1 };

    // act
    const starts = runStarts([
      { ref: older, path: "a.ts", added: 0, removed: 1 },
      { ref: newer, path: "a.ts", added: 1, removed: 0 },
      {
        ref: { component: FOUR, place: 0 },
        path: "a.ts",
        added: 1,
        removed: 0,
      },
    ]);

    // assert
    expect(sameRun(older, newer)).toBe(true);
    expect(sameRun(newer, { component: RENAME, place: 0 })).toBe(false);
    expect(starts.map((each) => each.ref.component.id)).toEqual([
      "rename",
      "four",
    ]);
  });
});

describe("fates", () => {
  test("calls a component new or gone only when both versions have maps", () => {
    // arrange
    const four = { component: FOUR, place: 0 };

    // act
    const mapped = interdiffFate(four, [OLDER], [RENAME, FOUR]);
    const unmapped = interdiffFate(four, [], [RENAME, FOUR]);
    const gone = interdiffFate({ component: OLDER, place: 0 }, [OLDER], [FOUR]);

    // assert
    expect([mapped, unmapped, gone]).toEqual(["new", "changed", "removed"]);
  });

  test("holds a place against its counterpart by the lines the comparison touches", () => {
    // arrange
    const renamed = { component: RENAME, place: 1 };
    const between = file(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,1 +2,1 @@
-two
+TWO
`);

    // act
    const since = counterpartFate(renamed, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [between],
    });
    const untouched = counterpartFate(renamed, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [],
    });
    const fresh = counterpartFate({ component: FOUR, place: 0 }, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [between],
    });

    // assert
    expect([since, untouched, fresh]).toEqual(["changed", "unchanged", "new"]);
  });
});

describe("marking text", () => {
  test("finds a word only whole, and a phrase anywhere", () => {
    // arrange
    const marks = new Map([
      ["Reply", 1],
      ["add-reply", 2],
    ]);

    // act
    const words = marked("replyToComment(Reply, add-reply)", marks, true);
    const phrases = marked("a Replyish thing", marks, false);

    // assert
    expect(words.filter((run) => run.mark !== null)).toEqual([
      { text: "Reply", mark: 1 },
      { text: "add-reply", mark: 2 },
    ]);
    expect(phrases.map((run) => run.text)).toEqual([
      "a ",
      "Reply",
      "ish thing",
    ]);
  });

  test("reads a mention across the message's line breaks", () => {
    // arrange
    const quoted = { ...RENAME, mentions: ["make two louder"] };

    // act
    const found = mentionedIn("louder\n\nWe make two\nlouder here.", quoted);

    // assert
    expect(found).toBe(true);
  });
});
```
