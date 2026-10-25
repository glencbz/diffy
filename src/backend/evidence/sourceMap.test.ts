// ~/~ begin <<docs/architecture/backend/runs.md#backend-evidence-source-map-test>>[init]
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMappings, mappedLinesRun, readSourceMap } from "./sourceMap";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-source-map-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("source maps", () => {
  test("segments carry their fields across lines", () => {
    // act
    const lines = decodeMappings("AAAA,IAAI;AACA,EAAE;;C");

    // assert
    expect(lines).toEqual([
      [
        { column: 0, source: 0, line: 0 },
        { column: 4, source: 0, line: 0 },
      ],
      [
        { column: 0, source: 0, line: 1 },
        { column: 2, source: 0, line: 1 },
      ],
      [],
      [{ column: 1, source: null, line: 0 }],
    ]);
  });

  test("the characters that ran in a bundle light their original lines", async () => {
    // arrange
    await Bun.write(
      join(dir, "shout.ts"),
      'export function shout(s: string): string {\n  return s.toUpperCase() + "!";\n}\n',
    );
    await Bun.write(
      join(dir, "main.ts"),
      'import { shout } from "./shout";\n\nconst unused = 1;\ndocument.title = shout("hi");\n',
    );
    const built = await Bun.build({
      entrypoints: [join(dir, "main.ts")],
      sourcemap: "external",
    });
    const bundle = built.outputs.find((out) => out.kind === "entry-point");
    const map = readSourceMap((await bundle?.sourcemap?.text()) ?? "");
    const text = (await bundle?.text()) ?? "";
    if (map === null) throw new Error("Bun.build wrote no map");
    const call = text.indexOf("toUpperCase");

    // act
    const ran = mappedLinesRun(
      text,
      [{ startOffset: call, endOffset: call + 11, count: 1 }],
      map,
    );

    // assert
    const shout = map.sources.findIndex((source) =>
      source.endsWith("shout.ts"),
    );
    expect([...ran]).toEqual([[shout, new Set([2])]]);
  });

  test("a map it cannot read is none", () => {
    // act
    // assert
    expect(readSourceMap("{}")).toBeNull();
    expect(readSourceMap("not json")).toBeNull();
  });
});
// ~/~ end
