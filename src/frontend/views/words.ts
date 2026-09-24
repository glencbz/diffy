// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-words>>[init]
import type { SyntaxKind, SyntaxToken } from "../api";
import type { HunkLine } from "./patch";

/** Characters `start` up to, not including, `end` of a line. */
export interface Range {
  start: number;
  end: number;
}

/** A piece of a syntax token, marked when its characters changed. */
export interface PaintedToken {
  text: string;
  kind: SyntaxKind | null;
  changed: boolean;
}

/** Below this share of the longer line in common, a pair is a rewrite. */
export const MIN_SHARED = 0.4;
/** The largest comparison table worth filling for one pair of lines. */
export const MAX_CELLS = 40_000;

const WORD = /\w+|\s+|[^\w\s]/g;

/** The changed ranges of every paired line in a hunk, by index in `lines`. */
export function changedLines(lines: HunkLine[]): Map<number, Range[]> {
  const ranges = new Map<number, Range[]>();
  let index = 0;

  while (index < lines.length) {
    const removed: number[] = [];
    while (lines[index]?.kind === "removed") removed.push(index++);
    const added: number[] = [];
    while (lines[index]?.kind === "added") added.push(index++);
    if (removed.length === 0 && added.length === 0) index++;

    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const before = removed[pair] as number;
      const after = added[pair] as number;
      const words = changedWords(codeOf(lines[before]), codeOf(lines[after]));
      if (words === null) continue;
      ranges.set(before, words.old);
      ranges.set(after, words.new);
    }
  }

  return ranges;
}

function codeOf(line: HunkLine | undefined): string {
  return line === undefined || line.kind === "note" ? "" : line.code;
}

/** The ranges of each line outside what the two share, or null when the two
 *  have too little in common, or are too long, to be worth marking. */
export function changedWords(
  before: string,
  after: string,
): { old: Range[]; new: Range[] } | null {
  const a = before.match(WORD) ?? [];
  const b = after.match(WORD) ?? [];
  if (a.length * b.length > MAX_CELLS) return null;

  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = common[i] as number[];
      const next = common[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const kept = { a: new Set<number>(), b: new Set<number>() };
  let shared = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      shared += (a[i] as string).length;
      kept.a.add(i++);
      kept.b.add(j++);
    } else if (
      (common[i + 1]?.[j] as number) >= (common[i]?.[j + 1] as number)
    ) {
      i++;
    } else {
      j++;
    }
  }

  if (shared < MIN_SHARED * Math.max(before.length, after.length)) {
    return null;
  }
  return { old: rangesOutside(a, kept.a), new: rangesOutside(b, kept.b) };
}

/** Character ranges of the words not in `kept`, neighbours merged. */
function rangesOutside(words: string[], kept: Set<number>): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  words.forEach((word, index) => {
    const end = offset + word.length;
    if (!kept.has(index)) {
      const last = ranges.at(-1);
      if (last !== undefined && last.end === offset) last.end = end;
      else ranges.push({ start: offset, end });
    }
    offset = end;
  });
  return ranges;
}

/** `tokens` cut at the edges of `ranges`, each piece marked when it falls
 *  inside one. */
export function paintWords(
  tokens: SyntaxToken[],
  ranges: Range[],
): PaintedToken[] {
  const painted: PaintedToken[] = [];
  let offset = 0;

  for (const token of tokens) {
    const end = offset + token.text.length;
    const cuts = new Set([offset, end]);
    for (const range of ranges) {
      if (range.start > offset && range.start < end) cuts.add(range.start);
      if (range.end > offset && range.end < end) cuts.add(range.end);
    }

    const edges = [...cuts].sort((x, y) => x - y);
    for (let edge = 0; edge < edges.length - 1; edge++) {
      const start = edges[edge] as number;
      const stop = edges[edge + 1] as number;
      painted.push({
        text: token.text.slice(start - offset, stop - offset),
        kind: token.kind,
        changed: ranges.some(
          (range) => range.start <= start && stop <= range.end,
        ),
      });
    }
    offset = end;
  }

  return painted;
}
// ~/~ end
