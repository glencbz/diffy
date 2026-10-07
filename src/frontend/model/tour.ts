// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-model-tour>>[init]
import type { FileDiff } from "./diff";
import type { Guide, GuideIdea, GuideStop } from "./guide";
import { gapsOf, readPatch } from "./patch";

/** One line of a file as a commit leaves it, with the lines it removed in
 *  place. `code` is the patch's text, which only lines in a hunk have; the
 *  rest are read off the file itself. */
export interface FileRow {
  kind: "context" | "added" | "removed";
  old: number | null;
  new: number | null;
  code: string | null;
}

/** Rows `[first, last]`, both included. */
export type Span = readonly [number, number];

export interface TourFile {
  /** The after-side path, or the before side's for a deleted file. */
  path: string;
  oldPath: string;
  diff: FileDiff;
  rows: FileRow[];
  /** Each hunk's rows, context included, in file order. */
  hunks: Span[];
}

export function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

function oldPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.oldPath;
}

/** Every row of `file`, given how long its after side is. Without the
 *  length, the rows stop after the last hunk. */
export function tourFile(file: FileDiff, length: number | null): TourFile {
  const patch = readPatch(file.patch);
  const rows: FileRow[] = [];
  const hunks: Span[] = [];
  const last = patch.hunks.at(-1);
  const end =
    length ??
    (last === undefined
      ? 0
      : last.newStart +
        last.lines.filter((line) => "newLine" in line).length -
        1);
  const gaps = file.newBlob === null ? [] : gapsOf(patch, end);

  patch.hunks.forEach((hunk, index) => {
    const gap = gaps[index];
    if (gap !== undefined) pushGap(rows, gap);
    const first = rows.length;
    for (const line of hunk.lines) {
      if (line.kind === "note") continue;
      rows.push({
        kind: line.kind,
        old: line.kind === "added" ? null : (line.oldLine ?? null),
        new: line.kind === "removed" ? null : line.newLine,
        code: line.code,
      });
    }
    if (rows.length > first) hunks.push([first, rows.length - 1]);
  });
  const tail = gaps[patch.hunks.length];
  if (tail !== undefined) pushGap(rows, tail);

  return {
    path: pathOf(file),
    oldPath: oldPathOf(file),
    diff: file,
    rows,
    hunks,
  };
}

function pushGap(
  rows: FileRow[],
  gap: { start: number; count: number; oldStart: number | null },
) {
  for (let i = 0; i < gap.count; i++) {
    rows.push({
      kind: "context",
      new: gap.start + i,
      old: gap.oldStart === null ? null : gap.oldStart + i,
      code: null,
    });
  }
}

/** The rows a stop's lines fall on, with the lines its first line replaced,
 *  or null when none of its lines is in the file. */
export function stopSpan(file: TourFile, stop: GuideStop): Span | null {
  const { start } = stop;
  if (start === undefined) return null;
  const end = stop.end ?? start;
  const side = stop.side === "before" ? "old" : "new";
  let first = -1;
  let last = -1;
  file.rows.forEach((row, index) => {
    const line = row[side];
    if (line === null || line < start || line > end) return;
    if (first === -1) first = index;
    last = index;
  });
  if (first === -1) return null;
  while (first > 0 && file.rows[first - 1]?.kind === "removed") first--;
  return [first, last];
}

function overlaps(a: Span, b: Span): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** One thing the reader reads in a commit: some rows of one file, or the
 *  commit's message. */
export type TourCard =
  | {
      key: string;
      kind: "file";
      ideaId: string;
      path: string;
      /** What the card is about, which it draws with a few rows around. */
      spans: Span[];
      note: string;
    }
  | { key: string; kind: "message"; ideaId: string; note: string };

export interface TourIdea {
  id: string;
  commitId: string;
  title: string;
  note: string;
  /** Whether the guide wrote it, rather than the tour gathering what the
   *  guide left out. */
  guided: boolean;
  cards: TourCard[];
  /** Lines added and removed in what its cards are about. */
  size: number;
}

export interface TourCommit {
  commitId: string;
  /** 1 for the oldest commit, as the reader sees it. */
  number: number;
  subject: string;
  description: string;
  files: TourFile[];
  ideas: TourIdea[];
}

/** A commit as the tour is handed it: its message, and its diff once that
 *  has loaded. */
export interface CommitInput {
  commitId: string;
  description: string;
  files: TourFile[];
}

const MESSAGE = "message";

function sizeOf(cards: TourCard[], files: Map<string, TourFile>): number {
  let size = 0;
  for (const card of cards) {
    if (card.kind !== "file") continue;
    const rows = files.get(card.path)?.rows ?? [];
    for (const [first, last] of card.spans) {
      for (let i = first; i <= last; i++) {
        if (rows[i]?.kind !== "context") size++;
      }
    }
  }
  return size;
}

/** What one commit reads as: the guide's ideas for it, then one idea per
 *  file for every hunk no stop covers. Without a guide every hunk is left
 *  out, so the commit reads file by file. */
export function tourCommit(
  input: CommitInput,
  number: number,
  ideas: GuideIdea[],
): TourCommit {
  const files = new Map(input.files.map((file) => [file.path, file]));
  const byPath = (path: string) =>
    files.get(path) ?? input.files.find((file) => file.oldPath === path);
  const covered = new Map<string, Span[]>();
  const cover = (path: string, span: Span) =>
    covered.set(path, [...(covered.get(path) ?? []), span]);

  const guided = ideas.map((idea): TourIdea => {
    const cards = idea.stops.flatMap((stop, index): TourCard[] => {
      const key = `${idea.id}#${index}`;
      if (stop.path === undefined) {
        return [{ key, kind: MESSAGE, ideaId: idea.id, note: stop.note }];
      }
      const file = byPath(stop.path);
      if (file === undefined) return [];
      const spans =
        stop.start === undefined
          ? file.hunks
          : [stopSpan(file, stop)].filter((span) => span !== null);
      if (spans.length === 0) return [];
      for (const span of spans) cover(file.path, span);
      return [
        {
          key,
          kind: "file",
          ideaId: idea.id,
          path: file.path,
          spans,
          note: stop.note,
        },
      ];
    });
    return {
      id: idea.id,
      commitId: input.commitId,
      title: idea.title,
      note: idea.note,
      guided: true,
      cards,
      size: sizeOf(cards, files),
    };
  });

  const rest = input.files.flatMap((file): TourIdea[] => {
    const spans = file.hunks.filter(
      (hunk) =>
        !(covered.get(file.path) ?? []).some((span) => overlaps(span, hunk)),
    );
    if (spans.length === 0) return [];
    const id = `${input.commitId}:${file.path}`;
    const cards: TourCard[] = [
      {
        key: `${id}#0`,
        kind: "file",
        ideaId: id,
        path: file.path,
        spans,
        note: "",
      },
    ];
    return [
      {
        id,
        commitId: input.commitId,
        title: file.path,
        note: "",
        guided: false,
        cards,
        size: sizeOf(cards, files),
      },
    ];
  });

  return {
    commitId: input.commitId,
    number,
    subject: input.description.split("\n")[0] || "(no description)",
    description: input.description,
    files: input.files,
    ideas: [...guided, ...rest],
  };
}

/** Every card of a commit in file order: the message first, then each
 *  file's cards from the top of the file down. */
export function fileOrder(commit: TourCommit): TourCard[] {
  const rank = new Map(commit.files.map((file, index) => [file.path, index]));
  const cards = commit.ideas.flatMap((idea) => idea.cards);
  const at = (card: TourCard) =>
    card.kind === MESSAGE
      ? [-1, 0]
      : [rank.get(card.path) ?? 0, card.spans[0]?.[0] ?? 0];
  return [...cards].sort((a, b) => {
    const [fa, ra] = at(a);
    const [fb, rb] = at(b);
    return (fa ?? 0) - (fb ?? 0) || (ra ?? 0) - (rb ?? 0);
  });
}

/** The idea of `commit` whose cards are about `row` of `path`. */
export function ideaAt(
  commit: TourCommit,
  path: string,
  row: number,
): TourIdea | undefined {
  return commit.ideas.find((idea) =>
    idea.cards.some(
      (card) =>
        card.kind === "file" &&
        card.path === path &&
        card.spans.some(([first, last]) => first <= row && row <= last),
    ),
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-model-tour>>[1]
/** Where in a commit a line is. */
export interface Site {
  commitId: string;
  path: string;
  row: number;
}

/** A name one commit adds a definition of, and where later commits use it. */
export interface Introduced {
  name: string;
  at: Site;
  usedAt: Site[];
}

// A definition in most languages diffy reads: a keyword, then the name.
const DEFINITION =
  /\b(?:function|const|let|var|class|type|interface|enum|def|fn|struct|trait|func)\s+([A-Za-z_]\w*)/g;

const PROSE = /\.(md|markdown|rst|txt|adoc)$/;

const TEST_FILE = /(^|[./_-])(test|spec)s?([./_-]|$)/;

/** A name worth linking: long enough and cased enough not to be a word. */
function linkable(name: string): boolean {
  return name.length >= 6 && /[A-Z]/.test(name) && /[a-z]/.test(name);
}

function definitions(code: string): string[] {
  return [...code.matchAll(DEFINITION)].flatMap((match) =>
    match[1] !== undefined && linkable(match[1]) ? [match[1]] : [],
  );
}

/** The names each commit defines that a later commit's added lines use,
 *  earliest definition first. A name a commit removes a definition of too
 *  was moved rather than introduced, and test files define nothing. */
export function introducedNames(commits: TourCommit[]): Introduced[] {
  const found = new Map<string, Introduced>();
  commits.forEach((commit, index) => {
    // Code before prose, so a name a literate document quotes is found where
    // the code defines it.
    const files = [...commit.files].sort(
      (a, b) => Number(PROSE.test(a.path)) - Number(PROSE.test(b.path)),
    );
    for (const file of files) {
      if (TEST_FILE.test(file.path)) continue;
      const removed = new Set(
        file.rows.flatMap((row) =>
          row.kind === "removed" ? definitions(row.code ?? "") : [],
        ),
      );
      file.rows.forEach((row, at) => {
        if (row.kind !== "added") return;
        for (const name of definitions(row.code ?? "")) {
          if (found.has(name) || removed.has(name)) continue;
          found.set(name, {
            name,
            at: { commitId: commit.commitId, path: file.path, row: at },
            usedAt: usesIn(commits.slice(index + 1), name),
          });
        }
      });
    }
  });
  return [...found.values()].filter((each) => each.usedAt.length > 0);
}

function usesIn(commits: TourCommit[], name: string): Site[] {
  const word = new RegExp(`\\b${name}\\b`);
  return commits.flatMap((commit) =>
    commit.files.flatMap((file) =>
      file.rows.flatMap((row, at) =>
        row.kind === "added" && word.test(row.code ?? "")
          ? [{ commitId: commit.commitId, path: file.path, row: at }]
          : [],
      ),
    ),
  );
}

/** One idea relying on another, from the guide or from a name. */
export interface TourLink {
  from: string;
  to: string;
  kind: "guide" | "name";
  /** What the guide says, or the names that make the link. */
  say: string;
}

/** The guide's links between ideas the tour has, and a link from each idea
 *  using a name to the idea that introduced it, one per pair of ideas. */
export function tourLinks(
  commits: TourCommit[],
  guide: Guide | undefined,
  names: Introduced[],
): TourLink[] {
  const ideas = new Set(
    commits.flatMap((commit) => commit.ideas.map((idea) => idea.id)),
  );
  const links: TourLink[] = (guide?.links ?? [])
    .filter((link) => ideas.has(link.from) && ideas.has(link.to))
    .map((link) => ({ ...link, kind: "guide" }));
  const byId = new Map(commits.map((commit) => [commit.commitId, commit]));
  const at = (site: Site) => {
    const commit = byId.get(site.commitId);
    return commit === undefined
      ? undefined
      : ideaAt(commit, site.path, site.row);
  };
  const named = new Map<string, TourLink>();
  for (const each of names) {
    const to = at(each.at);
    if (to === undefined) continue;
    for (const site of each.usedAt) {
      const from = at(site);
      if (from === undefined) continue;
      const key = `${from.id}\n${to.id}`;
      const kept = named.get(key);
      if (kept === undefined) {
        named.set(key, {
          from: from.id,
          to: to.id,
          kind: "name",
          say: each.name,
        });
      } else if (!kept.say.split(", ").includes(each.name)) {
        kept.say = `${kept.say}, ${each.name}`;
      }
    }
  }
  return [...links, ...named.values()];
}

export interface Tour {
  commits: TourCommit[];
  links: TourLink[];
  names: Introduced[];
}

export function buildTour(
  inputs: CommitInput[],
  guide: Guide | undefined,
): Tour {
  const commits = inputs.map((input, index) =>
    tourCommit(
      input,
      index + 1,
      (guide?.ideas ?? []).filter((idea) => idea.commitId === input.commitId),
    ),
  );
  const names = introducedNames(commits);
  return { commits, links: tourLinks(commits, guide, names), names };
}
// ~/~ end
