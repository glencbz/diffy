// ~/~ begin <<docs/architecture/backend/difft.md#difft-module>>[init]
import { availableParallelism } from "node:os";
import { Glob } from "bun";
import * as z from "zod";

/** A token difftastic says changed: a range of UTF-16 code units in `code`. */
export const ChangedRange = z.object({ start: z.number(), end: z.number() });
export type ChangedRange = z.infer<typeof ChangedRange>;

/** A line of a structural hunk. Numbers count from 1, as a patch's do. */
export const StructuralLine = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("context"),
    code: z.string(),
    newLine: z.number(),
  }),
  z.object({
    kind: z.literal("removed"),
    code: z.string(),
    oldLine: z.number(),
    changes: z.array(ChangedRange),
  }),
  z.object({
    kind: z.literal("added"),
    code: z.string(),
    newLine: z.number(),
    changes: z.array(ChangedRange),
  }),
]);
export type StructuralLine = z.infer<typeof StructuralLine>;

export const StructuralHunk = z.object({
  /** A `@@ -a,b +c,d @@` line, so both views label a hunk the same way. */
  header: z.string(),
  /** The after-side number of the hunk's first line, or of the line that
   *  would follow it when the hunk only removes. */
  newStart: z.number(),
  lines: z.array(StructuralLine),
});
export type StructuralHunk = z.infer<typeof StructuralHunk>;

/** One file's structural diff, or why it has none. */
export const StructuralDiff = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structural"),
    language: z.string(),
    hunks: z.array(StructuralHunk),
  }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type StructuralDiff = z.infer<typeof StructuralDiff>;

/** What the tool prints: every file it diffed, by path. */
export const StructuralDiffs = z.record(z.string(), StructuralDiff);

const DifftSide = z.object({
  line_number: z.number().int().nonnegative(),
  changes: z.array(
    z.object({ start: z.number().int(), end: z.number().int() }),
  ),
});
type DifftSide = z.infer<typeof DifftSide>;

/** One file of `difft --display=json`. Created, deleted, and unchanged files
 *  come without `aligned_lines` or `chunks`. */
export const DifftFile = z.object({
  language: z.string(),
  status: z.string(),
  aligned_lines: z
    .array(z.tuple([z.number().int().nullable(), z.number().int().nullable()]))
    .optional(),
  chunks: z
    .array(
      z.array(
        z.object({ lhs: DifftSide.optional(), rhs: DifftSide.optional() }),
      ),
    )
    .optional(),
});
export type DifftFile = z.infer<typeof DifftFile>;

const CONTEXT = 3;

/** A row of the alignment: a before-side and an after-side line, 0-based. */
type Row = [number | null, number | null];

/** A file's lines, without the empty one after a trailing newline. */
function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Where UTF-8 byte offset `byte` of `line` falls in its UTF-16 code units. */
function utf16At(line: string, byte: number): number {
  let bytes = 0;
  let units = 0;
  for (const char of line) {
    if (bytes >= byte) break;
    const point = char.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    units += char.length;
  }
  return units;
}

/** Every changed range difftastic names on one side, by 0-based line. */
function changesBySide(
  chunks: NonNullable<DifftFile["chunks"]>,
  side: "lhs" | "rhs",
  lines: string[],
): Map<number, ChangedRange[]> {
  const found = new Map<number, ChangedRange[]>();
  for (const entry of chunks.flat()) {
    const at: DifftSide | undefined = entry[side];
    if (at === undefined) continue;
    const line = lines[at.line_number] ?? "";
    const ranges = found.get(at.line_number) ?? [];
    for (const change of at.changes) {
      ranges.push({
        start: utf16At(line, change.start),
        end: utf16At(line, change.end),
      });
    }
    found.set(at.line_number, ranges);
  }
  return found;
}

/** Read difftastic's answer for one file into hunks, given both sides'
 *  text. Null when its line alignment does not account for every after-side
 *  line exactly once, in order, which the hunks' numbering depends on. */
export function readDifft(
  file: DifftFile,
  oldText: string,
  newText: string,
): StructuralHunk[] | null {
  const oldLines = linesOf(oldText);
  const newLines = linesOf(newText);
  const chunks = file.chunks ?? [];
  if (chunks.length === 0) return [];

  // Rows past the end of a side stand for the empty line after a trailing
  // newline, which neither side's line list has.
  const rows = (file.aligned_lines ?? [])
    .map(
      ([old, now]): Row => [
        old !== null && old < oldLines.length ? old : null,
        now !== null && now < newLines.length ? now : null,
      ],
    )
    .filter(([old, now]) => old !== null || now !== null);

  const afterSide = rows.flatMap(([, now]) => (now === null ? [] : [now]));
  if (
    afterSide.length !== newLines.length ||
    afterSide.some((now, index) => now !== index)
  ) {
    return null;
  }

  const oldChanges = changesBySide(chunks, "lhs", oldLines);
  const newChanges = changesBySide(chunks, "rhs", newLines);
  const changed = rows.map(
    ([old, now]) =>
      (old !== null && oldChanges.has(old)) ||
      (now !== null && newChanges.has(now)),
  );

  const kept = rows.map((_, index) =>
    changed
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some(Boolean),
  );

  const hunks: StructuralHunk[] = [];
  let index = 0;
  while (index < rows.length) {
    if (!kept[index]) {
      index++;
      continue;
    }
    const start = index;
    while (index < rows.length && kept[index]) index++;
    hunks.push(
      hunkOf(rows, start, index, changed, oldLines, newLines, {
        old: oldChanges,
        new: newChanges,
      }),
    );
  }
  return hunks;
}

/** Rows `[start, end)` as one hunk. */
function hunkOf(
  rows: Row[],
  start: number,
  end: number,
  changed: boolean[],
  oldLines: string[],
  newLines: string[],
  changes: {
    old: Map<number, ChangedRange[]>;
    new: Map<number, ChangedRange[]>;
  },
): StructuralHunk {
  const lines: StructuralLine[] = [];
  let removed: StructuralLine[] = [];
  let added: StructuralLine[] = [];
  const flush = () => {
    lines.push(...removed, ...added);
    removed = [];
    added = [];
  };

  for (let index = start; index < end; index++) {
    const [old, now] = rows[index] ?? [null, null];
    if (changed[index]) {
      if (old !== null) {
        removed.push({
          kind: "removed",
          code: oldLines[old] ?? "",
          oldLine: old + 1,
          changes: changes.old.get(old) ?? [],
        });
      }
      if (now !== null) {
        added.push({
          kind: "added",
          code: newLines[now] ?? "",
          newLine: now + 1,
          changes: changes.new.get(now) ?? [],
        });
      }
      continue;
    }
    flush();
    if (now !== null) {
      lines.push({
        kind: "context",
        code: newLines[now] ?? "",
        newLine: now + 1,
      });
    }
  }
  flush();

  const count = (side: 0 | 1, from: number, to: number) =>
    rows.slice(from, to).filter((row) => row[side] !== null).length;
  const oldStart = count(0, 0, start) + 1;
  const newStart = count(1, 0, start) + 1;
  const header = `@@ -${oldStart},${count(0, start, end)} +${newStart},${count(1, start, end)} @@`;

  return { header, newStart, lines };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/difft.md#difft-module>>[1]

/** Difftastic's own `DFT_BYTE_LIMIT` default. */
const BYTE_LIMIT = 1_000_000;
const TIMEOUT_MS = 10_000;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Diff one file between two paths, both of which exist. */
export async function difftFile(
  oldPath: string,
  newPath: string,
): Promise<StructuralDiff> {
  const difft = Bun.which("difft");
  if (difft === null) {
    return { kind: "unavailable", reason: "difftastic is not installed" };
  }

  const [before, after] = [Bun.file(oldPath), Bun.file(newPath)];
  if (before.size > BYTE_LIMIT || after.size > BYTE_LIMIT) {
    return {
      kind: "unavailable",
      reason: "too large for a structural diff",
    };
  }

  const run = Bun.spawn([difft, "--display=json", oldPath, newPath], {
    env: { ...process.env, DFT_UNSTABLE: "yes", NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: TIMEOUT_MS,
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(run.stdout).text(),
    run.exited,
  ]);
  if (run.signalCode !== null) {
    return { kind: "unavailable", reason: "difftastic took too long" };
  }
  if (exitCode !== 0) {
    return { kind: "unavailable", reason: `difftastic exited ${exitCode}` };
  }

  const parsed = DifftFile.safeParse(parseJson(stdout));
  if (!parsed.success) {
    return {
      kind: "unavailable",
      reason: "difftastic answered in a format diffy does not read",
    };
  }

  const hunks = readDifft(parsed.data, await before.text(), await after.text());
  return hunks === null
    ? { kind: "unavailable", reason: "difftastic's alignment did not add up" }
    : { kind: "structural", language: parsed.data.language, hunks };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/difft.md#difft-module>>[2]

/** Every file under `dir`, relative to it. */
async function filesUnder(dir: string): Promise<Set<string>> {
  const found = new Set<string>();
  for await (const path of new Glob("**/*").scan({ cwd: dir, dot: true })) {
    found.add(path);
  }
  return found;
}

/** Diff every file present under both `left` and `right`. */
export async function difftDirectories(
  left: string,
  right: string,
): Promise<Record<string, StructuralDiff>> {
  const [before, after] = await Promise.all([
    filesUnder(left),
    filesUnder(right),
  ]);
  const paths = [...after].filter((path) => before.has(path));

  const answers: Record<string, StructuralDiff> = {};
  let next = 0;
  const worker = async () => {
    for (let path = paths[next++]; path !== undefined; path = paths[next++]) {
      answers[path] = await difftFile(`${left}/${path}`, `${right}/${path}`);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(availableParallelism(), paths.length) },
      worker,
    ),
  );
  return answers;
}

if (import.meta.main) {
  const [left, right] = process.argv.slice(2);
  if (left === undefined || right === undefined) {
    throw new Error("usage: difft.ts <left> <right>");
  }
  process.stdout.write(JSON.stringify(await difftDirectories(left, right)));
}
// ~/~ end
