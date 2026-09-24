// ~/~ begin <<docs/architecture/backend/difft.md#difft-module-test>>[init]
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
// ~/~ end
