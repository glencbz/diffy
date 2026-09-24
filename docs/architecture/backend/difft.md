# Structural diffs

A line diff reports which lines differ. A function signature split over four
lines reads as one line removed and four added, even though no argument
changed. [Difftastic](https://difftastic.wilfred.me.uk/) parses both sides
with tree-sitter and compares the syntax trees, so the same edit reads as
no change at all, and a changed argument is marked as that argument rather
than as its whole line. Structural diffs are what diffy shows by default,
with the `git` patch kept alongside for the reader who wants lines. The
reader chooses per file. See the [diff view](../frontend/diff.md#diff-view).

## What difftastic gives us

`difft --display=json` prints one object per file. `aligned_lines` pairs up
every line of the two sides, `[before, after]`, with `null` where a line has
no counterpart. `chunks` names the lines that changed and, on each one, the
byte ranges of the tokens that did. Line numbers count from 0. The format is
marked unstable and refuses to run unless `DFT_UNSTABLE=yes` is set, so it is
parsed with Zod here and nowhere else, and the version is pinned by the
[Nix flake](../../devtools/nix.md).

Two things about it are easy to get wrong. The ranges count UTF-8 bytes, and
a JavaScript string counts UTF-16 code units, so `"héllo"` ends at 6 for
difftastic and at 5 for the browser. They are converted here, once, so the
wire only ever carries offsets into the string it also carries. And the JSON
never includes the text of a line, only its number, so the text comes from
the two files, which only exist while jj runs the tool (see [running
it](#running-it-under-jj)).

## From chunks to hunks

The frontend already draws a diff as hunks of numbered context, removed, and
added lines, so a structural diff is turned into the same shape rather than
drawn a second way. A hunk reads as the after side with the removed lines
interleaved, exactly like a patch hunk, which is what keeps the gutter,
comments, and hidden lines working on it unchanged.

Walking `aligned_lines` in order gives that reading directly. A row is
changed when either of its lines is one a chunk names. A run of changed rows
becomes its removed lines followed by its added lines, the order a patch
uses for an edit. An unchanged row is context from the after side.

Difftastic's own verdict on what is unchanged is kept even when the text
differs. A line that only moved in a reformat is an after-side line with no
before-side partner and no changed token. It is drawn as context, since it
is part of the after file and difftastic says nothing about it changed. Its
mirror, a before-side line that a reformat folded away, is not in the after
file at all, and is left out. A context line therefore has no before-side
number, which the frontend never needed.

Three rows of context on either side of a change is what `git` prints, so a
reader switching a file between the two views sees about the same amount of
file around each change.

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
```

## Running difftastic on a file

`difftFile` diffs one file between two paths on disk. Everything that can go
wrong is an answer rather than an exception: a file without a structural
diff still has its line diff, so the reader loses a view, not the file.

Difftastic falls back to a line diff of its own above a megabyte, and that
fallback is not cheap: a 4 MB file took 38 seconds. A file over the same
limit is refused before difftastic starts, and a timeout covers whatever the
limit does not. Past either one, the reader has the `git` patch, which is the
same line diff difftastic would have fallen back to.

```ts
//| id: difft-module

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
```

## Running it under jj

The two sides of a diff are not always files anywhere. An
[interdiff](jj.md#comparing-two-commits)'s before side is a tree jj builds
for the comparison and never writes down, so neither `git` nor jj can hand
it over by id afterwards. What jj can do is run an external diff tool with
both sides written out as two directories, `left` and `right`, which it
deletes once the tool exits. That is the only moment both files exist, so
the text of each line has to be read then, which is why the tool jj runs is
this module rather than `difft` itself.

Run as a script, it diffs every file present in both directories and prints
one JSON object keyed by path. jj only writes the files the diff touches, so
nothing is diffed that the patch does not also report. A file on only one
side is left out. Added and deleted files read the same either way, and a
rename puts its two halves under different paths, so there is no pair to
compare.

Files are diffed in parallel, up to one per core. A row with many files
would otherwise start one difftastic per file at once, and a series of rows
does that many times over.

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
```

## Test

`readDifft` is tested against difftastic's real output for small files,
recorded once so the tests pin what diffy does with that shape. The run
through `difftFile` is tested against the real binary, so a difftastic
upgrade that changes the format fails here first.

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
    expect(lines[8]).toMatchObject({ kind: "context", newLine: 7 });
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
