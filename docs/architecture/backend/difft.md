# Structural diffs

[Difftastic](https://difftastic.wilfred.me.uk/) compares syntax trees, so a
signature reflowed over four lines reads as no change, and a changed argument
is marked as that argument rather than its whole line. Structural diffs are
the default view, with the `git` patch kept for readers who want lines, per
file (see the [diff view](../frontend/diff.md#diff-view)).

`difft --display=json` is marked unstable (it needs `DFT_UNSTABLE=yes`), so it
is parsed with Zod here and nowhere else and the version is pinned by the
[Nix flake](../../devtools/nix.md). The JSON gives line numbers but never line
text, so the text has to be read from the two files while they exist (see
[running it under jj](#running-it-under-jj)).

## From chunks to hunks

A structural diff is turned into the same hunks a patch gives, the after side
with removed lines interleaved, so the gutter, comments, and hidden lines work
on it unchanged. Difftastic's verdict on what is unchanged wins even when the
text differs: a line that only moved in a reformat is context, and its
before-side twin is left out. A context line keeps its before-side number
where it has a partner, for the [side-by-side](../frontend/diff.md#side-by-side)
before column.

```ts
//| id: difft-module
//| file: src/backend/commit/difft.ts
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
    oldLine: z.number().optional(),
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
  /** The same on the before side. */
  oldStart: z.number(),
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

/** What `git` prints, so switching views shows about the same context. */
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
        ...(old === null ? {} : { oldLine: old + 1 }),
      });
    }
  }
  flush();

  const count = (side: 0 | 1, from: number, to: number) =>
    rows.slice(from, to).filter((row) => row[side] !== null).length;
  const oldStart = count(0, 0, start) + 1;
  const newStart = count(1, 0, start) + 1;
  const header = `@@ -${oldStart},${count(0, start, end)} +${newStart},${count(1, start, end)} @@`;

  return { header, newStart, oldStart, lines };
}
```

## Running difftastic on a file

`difftFile` answers every failure as `unavailable` rather than throwing: the
file still has its line diff, so the reader loses a view, not the file.

```ts
//| id: difft-module

/** Difftastic's own `DFT_BYTE_LIMIT`. Above it difftastic falls back to a slow
 *  line diff of its own (a 4 MB file took 38 s), the same one `git` gives. */
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
```

## Running it under jj

An [interdiff](jj.md#comparing-two-commits)'s before side is a tree jj builds
and never writes down, so it cannot be fetched by id afterwards. jj can run an
external diff tool with both sides written to two directories, deleted when
the tool exits, so the tool jj runs is this module ([`diffy
difft`](cli.md#difftastic-as-jjs-diff-tool)), which reads the line text while
the files exist. jj writes only the files the diff touches. A file on one side
only (an add, a delete, either half of a rename) has no pair and is skipped.

```ts
//| id: difft-module

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

  // At most one difftastic per core; a series of many-file rows would
  // otherwise start hundreds at once.
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
```

## Test

`readDifft` runs on recorded difftastic output; `difftFile` runs the real
binary, so a format change in an upgrade fails here first.

```ts
//| id: difft-module-test
//| file: src/backend/commit/difft.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DifftFile, difftFile, readDifft } from "./difft";

const before = [
  "function f() {",
  "  const a = 1;",
  "  const b = 2;",
  "  const c = 3;",
  "  return a;",
  "}",
  "",
].join("\n");

const after = [
  "function f() {",
  "  const a = 10;",
  "  const b = 2;",
  "  const c = 30;",
  "  log(a);",
  "  return a;",
  "}",
  "",
].join("\n");

/** `difft --display=json` for `before` against `after`, as 0.71.0 prints it. */
const recorded = DifftFile.parse({
  aligned_lines: [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [null, 4],
    [4, 5],
    [5, 6],
    [6, 7],
  ],
  chunks: [
    [
      {
        rhs: {
          line_number: 4,
          changes: [
            { start: 2, end: 5 },
            { start: 5, end: 6 },
            { start: 6, end: 7 },
            { start: 7, end: 8 },
            { start: 8, end: 9 },
          ],
        },
      },
      {
        lhs: { line_number: 1, changes: [{ start: 12, end: 13 }] },
        rhs: { line_number: 1, changes: [{ start: 12, end: 14 }] },
      },
      {
        lhs: { line_number: 3, changes: [{ start: 12, end: 13 }] },
        rhs: { line_number: 3, changes: [{ start: 12, end: 14 }] },
      },
    ],
  ],
  language: "TypeScript",
  status: "changed",
});

async function sides(
  oldText: string,
  newText: string,
  name = "f.ts",
): Promise<[string, string]> {
  const dir = await mkdtemp(join(tmpdir(), "diffy-difft-"));
  const [oldPath, newPath] = [
    join(dir, `old-${name}`),
    join(dir, `new-${name}`),
  ];
  await Promise.all([writeFile(oldPath, oldText), writeFile(newPath, newText)]);
  return [oldPath, newPath];
}

describe("readDifft", () => {
  test("reads the after side with each edit's removed lines before its added ones", () => {
    // arrange
    // act
    const hunks = readDifft(recorded, before, after);

    // assert
    expect(hunks).toHaveLength(1);
    expect(hunks?.[0]?.header).toBe("@@ -1,6 +1,7 @@");
    expect(hunks?.[0]?.lines.map((line) => [line.kind, line.code])).toEqual([
      ["context", "function f() {"],
      ["removed", "  const a = 1;"],
      ["added", "  const a = 10;"],
      ["context", "  const b = 2;"],
      ["removed", "  const c = 3;"],
      ["added", "  const c = 30;"],
      ["added", "  log(a);"],
      ["context", "  return a;"],
      ["context", "}"],
    ]);
  });

  test("numbers every line from 1 on the side it is read from", () => {
    // arrange
    // act
    const lines = readDifft(recorded, before, after)?.[0]?.lines ?? [];

    // assert
    expect(lines[1]).toMatchObject({ kind: "removed", oldLine: 2 });
    expect(lines[6]).toMatchObject({ kind: "added", newLine: 5 });
    expect(lines[8]).toMatchObject({ kind: "context", newLine: 7, oldLine: 6 });
  });

  test("keeps only the changed tokens' ranges", () => {
    // arrange
    // act
    const lines = readDifft(recorded, before, after)?.[0]?.lines ?? [];

    // assert
    expect(lines[2]).toMatchObject({ changes: [{ start: 12, end: 14 }] });
  });

  test("reads nothing out of a file with no chunks", () => {
    // arrange
    const unchanged = DifftFile.parse({
      language: "TypeScript",
      status: "unchanged",
    });

    // act
    // assert
    expect(readDifft(unchanged, before, before)).toEqual([]);
  });

  test("refuses an alignment that skips an after-side line", () => {
    // arrange
    const gappy = {
      ...recorded,
      aligned_lines: recorded.aligned_lines?.slice(1),
    };

    // act
    // assert
    expect(readDifft(gappy, before, after)).toBeNull();
  });
});

describe("difftFile", () => {
  test("answers what the recorded output does", async () => {
    // arrange
    const [oldPath, newPath] = await sides(before, after);

    // act
    const diff = await difftFile(oldPath, newPath);

    // assert
    expect(diff).toEqual({
      kind: "structural",
      language: "TypeScript",
      hunks: readDifft(recorded, before, after) ?? [],
    });
  });

  test("finds no change in a reformat", async () => {
    // arrange
    const [oldPath, newPath] = await sides("f(a, b);\n", "f(\n  a,\n  b\n);\n");

    // act
    // assert
    expect(await difftFile(oldPath, newPath)).toMatchObject({ hunks: [] });
  });

  test("counts ranges in UTF-16 code units, not bytes", async () => {
    // arrange
    const [oldPath, newPath] = await sides(
      'const s = "héllo";\n',
      'const s = "héllo wörld";\n',
    );

    // act
    const diff = await difftFile(oldPath, newPath);

    // assert
    const added =
      diff.kind === "structural"
        ? diff.hunks[0]?.lines.find((line) => line.kind === "added")
        : undefined;
    const changes = added?.kind === "added" ? added.changes : [];
    expect(
      changes.map((range) => added?.code.slice(range.start, range.end)),
    ).toContain("wörld");
  });

  test("refuses a file over the size limit without running difftastic", async () => {
    // arrange
    const big = "x\n".repeat(600_000);
    const [oldPath, newPath] = await sides(big, `${big}y\n`, "big.txt");

    // act
    // assert
    expect(await difftFile(oldPath, newPath)).toEqual({
      kind: "unavailable",
      reason: "too large for a structural diff",
    });
  });
});
```
