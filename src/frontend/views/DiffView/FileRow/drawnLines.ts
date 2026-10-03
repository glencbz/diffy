// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-drawn-lines>>[init]
import type { FileDiff, StructuralDiff } from "../../../model/diff";
import {
  gapsOf,
  type HunkLine,
  type Patch,
  readPatch,
} from "../../../model/patch";
import type { LineAnchor } from "../../../model/review";
import type {
  SourceFile,
  SourceLookup,
  SyntaxToken,
} from "../../../model/source";
import {
  changedLines,
  markable,
  type PaintedToken,
  paintWords,
  type Range,
} from "../../../model/words";

/** The column a line is drawn in, when the diff has two. */
export type Side = "before" | "after";

export type CodeKind = "context" | "added" | "removed";

/** One line as drawn. Hunk headers and notes are text in one
 *  colour. A line of the file is its tokens and where it sits: a removed line
 *  on the before side, every other line on the after side. It also carries
 *  its before-side number where it has one, for the before column of a
 *  [side-by-side](#side-by-side) diff. A gap stands in for the lines
 *  `gapsOf` numbered `gap` until it is shown. */
export type DrawnLine =
  | { kind: "meta" | "hunk"; text: string }
  | { kind: "gap"; gap: number; count: number }
  | {
      kind: CodeKind;
      tokens: PaintedToken[];
      anchor: LineAnchor;
      beforeLine: number | null;
    };

/** Each side of one file, whole, where it has loaded. */
export interface FileSides {
  old: SourceFile | null;
  new: SourceFile | null;
}

export function sidesOf(file: FileDiff, sources?: SourceLookup): FileSides {
  const oldPath = "path" in file ? file.path : file.oldPath;
  const newPath = "path" in file ? file.path : file.newPath;
  return {
    old:
      sources === undefined || file.oldBlob === null
        ? null
        : sources(file.oldBlob, oldPath),
    new:
      sources === undefined || file.newBlob === null
        ? null
        : sources(file.newBlob, newPath),
  };
}

/** What a file's lines are drawn from: hunks, and each hunk's changed
 *  ranges by line index. */
interface Body {
  patch: Patch;
  changed: Map<number, Range[]>[];
}

/** A patch's hunks, without the `diff --git` lines above them, which say
 *  nothing the file's own header does not. */
export function patchBody(text: string): Body {
  const { hunks } = readPatch(text);
  return {
    patch: { header: [], hunks },
    changed: hunks.map((hunk) => changedLines(hunk.lines)),
  };
}

/** Difftastic's hunks, with a note in place of them when it found the
 *  change was only layout. Where it fell back to comparing text, its
 *  ranges are whole lines, so the words are paired as a patch's are. */
export function structuralBody(
  diff: Extract<StructuralDiff, { kind: "structural" }>,
  wordMarkLimit: number,
): Body {
  return {
    patch: {
      header:
        diff.hunks.length === 0
          ? ["No syntactic change. The line view shows the layout edits."]
          : [],
      hunks: diff.hunks,
    },
    changed: diff.hunks.map((hunk) =>
      diff.language.startsWith("Text")
        ? changedLines(hunk.lines)
        : new Map(
            hunk.lines.flatMap((line, index) =>
              line.kind === "context"
                ? []
                : [[index, markable(line.code, line.changes, wordMarkLimit)]],
            ),
          ),
    ),
  };
}

export function drawnLines(
  { patch, changed: changedIn }: Body,
  sides: FileSides,
  shown: ReadonlySet<number>,
): DrawnLine[] {
  const gaps =
    sides.new === null || patch.hunks.length === 0
      ? []
      : gapsOf(patch, sides.new.lines.length);

  const hidden = (index: number): DrawnLine[] => {
    const gap = gaps[index];
    if (gap === undefined || gap.count === 0) return [];
    if (!shown.has(index))
      return [{ kind: "gap", gap: index, count: gap.count }];
    return Array.from({ length: gap.count }, (_, offset) => ({
      kind: "context" as const,
      tokens: paintWords(sides.new?.lines[gap.start + offset - 1] ?? [], []),
      anchor: { side: "after" as const, line: gap.start + offset },
      beforeLine: gap.oldStart === null ? null : gap.oldStart + offset,
    }));
  };

  return [
    ...patch.header.map((text): DrawnLine => ({ kind: "meta", text })),
    ...patch.hunks.flatMap((hunk, index) => {
      const changed = changedIn[index] ?? new Map<number, Range[]>();
      return [
        ...hidden(index),
        ...(shown.has(index)
          ? []
          : [{ kind: "hunk" as const, text: hunk.header }]),
        ...hunk.lines.map((line, at) =>
          drawnHunkLine(line, sides, changed.get(at) ?? []),
        ),
      ];
    }),
    ...hidden(patch.hunks.length),
  ];
}

function drawnHunkLine(
  line: HunkLine,
  sides: FileSides,
  changed: Range[],
): DrawnLine {
  switch (line.kind) {
    case "context":
      return {
        kind: "context",
        tokens: paintWords(tokensAt(sides.new, line.newLine, line.code), []),
        anchor: { side: "after", line: line.newLine },
        beforeLine: line.oldLine ?? null,
      };
    case "added":
      return {
        kind: "added",
        tokens: paintWords(
          tokensAt(sides.new, line.newLine, line.code),
          changed,
        ),
        anchor: { side: "after", line: line.newLine },
        beforeLine: null,
      };
    case "removed":
      return {
        kind: "removed",
        tokens: paintWords(
          tokensAt(sides.old, line.oldLine, line.code),
          changed,
        ),
        anchor: { side: "before", line: line.oldLine },
        beforeLine: line.oldLine,
      };
    case "note":
      return { kind: "meta", text: line.text };
  }
}

/** The highlighted tokens for line `number` of a side, or the code as one
 *  plain token when the side has not loaded or does not say the same thing
 *  the patch does. */
function tokensAt(
  side: SourceFile | null,
  number: number,
  code: string,
): SyntaxToken[] {
  const tokens = side?.lines[number - 1];
  if (tokens?.map((token) => token.text).join("") === code) return tokens;
  return [{ text: code, kind: null }];
}
// ~/~ end
