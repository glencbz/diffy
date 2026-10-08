// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-model-guided>>[init]
import type { FileDiff } from "./diff";
import type { GuideIdea, GuideStop } from "./guide";
import { readPatch } from "./patch";
import type { LineAnchor } from "./review";

/** A line as a diff draws it: where it sits, and its before-side number
 *  where it has one. */
export interface GuidedLine {
  anchor: LineAnchor;
  beforeLine: number | null;
}

export function lineKey({ side, line }: LineAnchor): string {
  return `${side}:${line}`;
}

/** The lines one stop covers: a run on one side, and lines named outright,
 *  which are a whole file's hunks or the lines a run's first line replaced. */
export interface Cover {
  side: "before" | "after";
  start: number;
  end: number;
  also: ReadonlySet<string>;
}

export function covers(cover: Cover, { anchor, beforeLine }: GuidedLine) {
  if (cover.also.has(lineKey(anchor))) return true;
  const line = cover.side === "after" ? anchor.line : beforeLine;
  if (cover.side === "after" && anchor.side !== "after") return false;
  return line !== null && cover.start <= line && line <= cover.end;
}

/** One line of a patch, with its kind. */
interface PatchLine extends GuidedLine {
  changed: boolean;
}

function patchLines(patch: string): PatchLine[] {
  return readPatch(patch).hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line): PatchLine[] => {
      if (line.kind === "note") return [];
      if (line.kind === "removed") {
        return [
          {
            anchor: { side: "before", line: line.oldLine },
            beforeLine: line.oldLine,
            changed: true,
          },
        ];
      }
      return [
        {
          anchor: { side: "after", line: line.newLine },
          beforeLine: line.kind === "context" ? (line.oldLine ?? null) : null,
          changed: line.kind === "added",
        },
      ];
    }),
  );
}

export function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

function oldPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.oldPath;
}

/** What `stop` covers in a file whose patch has `lines`. A stop with no
 *  lines covers every hunk of its file. A run takes in the lines its first
 *  line replaced, which sit just above it as removed lines. */
export function coverOf(stop: GuideStop, lines: PatchLine[]): Cover {
  if (stop.start === undefined) {
    return {
      side: "after",
      start: 1,
      end: 0,
      also: new Set(lines.map((line) => lineKey(line.anchor))),
    };
  }
  const run: Cover = {
    side: stop.side,
    start: stop.start,
    end: stop.end ?? stop.start,
    also: new Set(),
  };
  const first = lines.findIndex((line) => covers(run, line));
  const also = new Set<string>();
  for (let at = first - 1; at >= 0; at--) {
    const line = lines[at];
    if (line === undefined || line.anchor.side !== "before") break;
    also.add(lineKey(line.anchor));
  }
  return { ...run, also };
}

/** The colours ideas take in the order the guide lists them, over again
 *  past the fifth. */
export const IDEA_COLOURS = [
  "blue",
  "amber",
  "green",
  "purple",
  "teal",
] as const;
export type IdeaColour = (typeof IDEA_COLOURS)[number];

export interface GuidedIdea {
  title: string;
  note: string;
  colour: IdeaColour;
  /** How many of its stops the guide wrote. */
  stops: number;
}

/** What the guide says at one stop. */
export interface GuidedNote {
  /** Unique across the commits of a version. */
  key: string;
  /** The idea's index in the commit's ideas. */
  idea: number;
  /** The stop's index in its idea. */
  stop: number;
  note: string;
  /** The file it is about, or null for the commit's message. */
  path: string | null;
  /** The lines it is about, and the line its tab goes on. */
  cover: Cover | null;
  anchor: LineAnchor | null;
}

/** One file of the commit, for the rail: its size, and the idea each of
 *  its changed lines belongs to, in patch order. */
export interface GuidedFile {
  path: string;
  added: number;
  removed: number;
  owners: (number | null)[];
}

export interface GuidedCommit {
  commitId: string;
  /** In the order the diff lists them. */
  files: GuidedFile[];
  ideas: GuidedIdea[];
  /** Each file's stops, in the guide's order, by after-side path. */
  covers: Map<string, { idea: number; cover: Cover }[]>;
  notes: GuidedNote[];
}

/** The idea a drawn line of `path` belongs to: the first whose stop covers
 *  it, or null for none. */
export function ideaOf(
  commit: GuidedCommit,
  path: string,
  line: GuidedLine,
): number | null {
  return (
    commit.covers.get(path)?.find(({ cover }) => covers(cover, line))?.idea ??
    null
  );
}

/** A commit's diff read with its guide: each line takes the colour of the
 *  first idea whose stop covers it, and each stop's note sits at the first
 *  line it changes. Read against an older version of the commit rather
 *  than its parent, `beforeSide` is false: the before side is then the old
 *  version, which the guide's before-side numbers do not count. */
export function guidedCommit(
  commitId: string,
  files: FileDiff[],
  ideas: GuideIdea[],
  { beforeSide }: { beforeSide: boolean },
): GuidedCommit {
  const linesOf = new Map(
    files.map((file) => [pathOf(file), patchLines(file.patch)]),
  );
  const byPath = (path: string) =>
    files.find((file) => pathOf(file) === path || oldPathOf(file) === path);
  const coversOf = new Map<string, { idea: number; cover: Cover }[]>();
  const taken = new Map<string, Set<string>>();

  const notes = ideas.flatMap((idea, ideaIndex) =>
    idea.stops.flatMap((stop, stopIndex): GuidedNote[] => {
      const key = `${commitId}:${ideaIndex}.${stopIndex}`;
      const base = { key, idea: ideaIndex, stop: stopIndex, note: stop.note };
      if (stop.path === undefined) {
        return [{ ...base, path: null, cover: null, anchor: null }];
      }
      const file = byPath(stop.path);
      if (file === undefined) return [];
      const path = pathOf(file);
      if (!beforeSide && stop.side === "before" && stop.start !== undefined) {
        return [{ ...base, path, cover: null, anchor: null }];
      }
      const lines = linesOf.get(path) ?? [];
      const cover = coverOf(stop, lines);
      coversOf.set(path, [
        ...(coversOf.get(path) ?? []),
        { idea: ideaIndex, cover },
      ]);
      const used = taken.get(path) ?? new Set<string>();
      taken.set(path, used);
      const anchor = anchorIn(cover, lines, used);
      used.add(lineKey(anchor));
      return [{ ...base, path, cover, anchor }];
    }),
  );

  const guided: GuidedCommit = {
    commitId,
    files: [],
    ideas: ideas.map((idea, index) => ({
      title: idea.title,
      note: idea.note,
      colour: IDEA_COLOURS[index % IDEA_COLOURS.length] ?? "blue",
      stops: idea.stops.length,
    })),
    covers: coversOf,
    notes,
  };
  guided.files = files.map((file) => {
    const path = pathOf(file);
    const changed = (linesOf.get(path) ?? []).filter((line) => line.changed);
    return {
      path,
      added: changed.filter((line) => line.anchor.side === "after").length,
      removed: changed.filter((line) => line.anchor.side === "before").length,
      owners: changed.map((line) => ideaOf(guided, path, line)),
    };
  });
  return guided;
}

/** The line a note's tab goes on: the first line it covers that changes,
 *  so the tab marks the change rather than the context above it, and the
 *  next one along when another note's tab is already there. A stop none of
 *  whose lines the patch shows starts at its first line, out of sight
 *  until the reader opens the lines around it. */
function anchorIn(
  cover: Cover,
  lines: PatchLine[],
  used: Set<string>,
): LineAnchor {
  const mine = lines.filter((line) => covers(cover, line));
  const free = mine.filter((line) => !used.has(lineKey(line.anchor)));
  return (
    free.find((line) => line.changed)?.anchor ??
    free[0]?.anchor ??
    mine[0]?.anchor ?? { side: cover.side, line: cover.start }
  );
}
// ~/~ end
