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
  lines: HunkLine[];
}

/** A line inside a hunk. `code` is the line without its `+`, `-`, or space,
 *  and line numbers count from 1, as each side's file has them. */
export type HunkLine =
  | { kind: "context"; code: string; oldLine: number; newLine: number }
  | { kind: "removed"; code: string; oldLine: number }
  | { kind: "added"; code: string; newLine: number }
  | { kind: "note"; text: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

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
      oldLine = Number(start[1]);
      newLine = Number(start[2]);
      hunks.push({ header: text, lines: [] });
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
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return { header, hunks };
}
// ~/~ end
