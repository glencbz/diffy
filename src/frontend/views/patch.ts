// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-patch>>[init]
/** A file's patch read into the hunks it is made of. */
export interface Patch {
  /** Everything above the first hunk: `diff --git`, `index`, `---`, `+++`,
   *  and any mode or rename lines. */
  header: string[];
  hunks: Hunk[];
}

export interface Hunk {
  /** The `@@ -a,b +c,d @@` line, with whatever context git printed after it. */
  header: string;
  /** The after-side number of the hunk's first line, or of the line that
   *  would follow it when the hunk only removes. */
  newStart: number;
  /** The same on the before side, where the hunk says. A structural hunk
   *  does not. */
  oldStart?: number;
  lines: HunkLine[];
}

/** A line inside a hunk. `code` is the line without its `+`, `-`, or space,
 *  and line numbers count from 1, as each side's file has them. A context
 *  line has no `oldLine` when it has no before-side partner, which only a
 *  structural hunk has. */
export type HunkLine =
  | { kind: "context"; code: string; newLine: number; oldLine?: number }
  | { kind: "removed"; code: string; oldLine: number }
  | { kind: "added"; code: string; newLine: number }
  | { kind: "note"; text: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Where a side's count starts. A side with no lines in the hunk names the
 *  line before the hunk, so its next line is one further on. */
function firstLine(start: string | undefined, count: string | undefined) {
  return Number(start) + (count === "0" ? 1 : 0);
}

export function readPatch(patch: string): Patch {
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();

  for (const text of lines) {
    const start = text.match(HUNK_HEADER);
    if (start !== null) {
      oldLine = firstLine(start[1], start[2]);
      newLine = firstLine(start[3], start[4]);
      hunks.push({
        header: text,
        newStart: newLine,
        oldStart: oldLine,
        lines: [],
      });
      continue;
    }

    const hunk = hunks.at(-1);
    if (hunk === undefined) {
      header.push(text);
      continue;
    }

    const code = text.slice(1);
    if (text.startsWith("+")) {
      hunk.lines.push({ kind: "added", code, newLine: newLine++ });
    } else if (text.startsWith("-")) {
      hunk.lines.push({ kind: "removed", code, oldLine: oldLine++ });
    } else if (text.startsWith("\\")) {
      hunk.lines.push({ kind: "note", text });
    } else {
      hunk.lines.push({
        kind: "context",
        code,
        newLine: newLine++,
        oldLine: oldLine++,
      });
    }
  }

  return { header, hunks };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-patch>>[1]

/** Unchanged after-side lines the patch left out, `count` of them from line
 *  `start` on, which is line `oldStart` on the before side. */
export interface Gap {
  start: number;
  count: number;
  oldStart: number | null;
}

/** One gap before each hunk and one after the last, empty where the hunks
 *  already meet or reach the end, for an after side `length` lines long. */
export function gapsOf(patch: Patch, length: number): Gap[] {
  const gaps: Gap[] = [];
  let next = 1;
  let oldNext: number | null = 1;

  for (const hunk of patch.hunks) {
    const count = Math.max(0, hunk.newStart - next);
    gaps.push({
      start: next,
      count,
      oldStart: hunk.oldStart === undefined ? null : hunk.oldStart - count,
    });
    next =
      hunk.newStart + hunk.lines.filter((line) => "newLine" in line).length;
    oldNext =
      hunk.oldStart === undefined
        ? null
        : hunk.oldStart + hunk.lines.filter((line) => "oldLine" in line).length;
  }
  gaps.push({
    start: next,
    count: Math.max(0, length - next + 1),
    oldStart: oldNext,
  });

  return gaps;
}
// ~/~ end
