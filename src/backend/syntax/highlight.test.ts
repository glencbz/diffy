// ~/~ begin <<docs/architecture/backend/syntax.md#backend-syntax-test>>[init]
import { describe, expect, test } from "bun:test";
import { highlightSource, languageOf, MAX_HIGHLIGHT_BYTES } from "./highlight";

describe("languageOf", () => {
  test("reads a language off a file's extension", () => {
    // arrange
    // act
    // assert
    expect(languageOf("src/frontend/App.tsx")).toBe("tsx");
    expect(languageOf("include/list.h")).toBe("c");
  });

  test("prefers a basename it knows over an extension", () => {
    // arrange
    // act
    // assert
    expect(languageOf("justfile")).toBe("justfile");
    expect(languageOf("docker/Dockerfile")).toBe("dockerfile");
  });

  test("knows no language for a name it has never heard of", () => {
    // arrange
    // act
    // assert
    expect(languageOf("notes.xyzzy")).toBeNull();
    expect(languageOf("LICENSE")).toBeNull();
  });
});

describe("highlightSource", () => {
  const code = 'const greeting = "hi"; // say it\n\nexport default greeting;\n';

  test("hands back every line, tokens joining to the line", async () => {
    // arrange
    // act
    const source = await highlightSource(code, "greet.ts");

    // assert
    expect(source.language).toBe("ts");
    expect(
      source.lines.map((line) => line.map((t) => t.text).join("")),
    ).toEqual([
      'const greeting = "hi"; // say it',
      "",
      "export default greeting;",
    ]);
  });

  test("sorts tokens into kinds", async () => {
    // arrange
    // act
    const source = await highlightSource(code, "greet.ts");
    const kinds = new Set(source.lines.flat().map((token) => token.kind));

    // assert
    expect(kinds).toContain("keyword");
    expect(kinds).toContain("comment");
    expect(kinds).toContain(null);
  });

  test("merges neighbours of one kind", async () => {
    // arrange
    // act
    const source = await highlightSource(code, "greet.ts");

    // assert
    for (const line of source.lines) {
      line.slice(1).forEach((token, index) => {
        expect(token.kind).not.toBe(line[index]?.kind);
      });
    }
  });

  test("returns plain lines for a language it does not know", async () => {
    // arrange
    // act
    const source = await highlightSource("one\ntwo", "notes.xyzzy");

    // assert
    expect(source).toEqual({
      language: null,
      lines: [[{ text: "one", kind: null }], [{ text: "two", kind: null }]],
    });
  });

  test("returns a file too large to highlight as plain lines", async () => {
    // arrange
    const huge = "x\n".repeat(MAX_HIGHLIGHT_BYTES);

    // act
    const source = await highlightSource(huge, "huge.ts");

    // assert
    expect(source.language).toBeNull();
    expect(source.lines).toHaveLength(MAX_HIGHLIGHT_BYTES);
  });
});
// ~/~ end
