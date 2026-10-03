# Syntax highlighting

A hunk that opens inside a multi-line string reads wrong when highlighted
alone, so the server highlights whole files, one side at a time, and the diff
view picks out the lines it needs. [Shiki](https://shiki.style/) runs VS
Code's TextMate grammars in Bun with no build step. Tree-sitter would add a
syntax tree nobody here needs.

Shiki's CSS variables theme names each token's kind (`keyword`) rather than
a colour, and the frontend colours kinds in [its own tokens](../frontend/tokens.md),
so highlighting follows the app's light and dark themes and one answer serves
both.

Highlighting is synchronous and holds the event loop, so a file past
`MAX_HIGHLIGHT_BYTES` comes back plain rather than stalling every other
request.

```ts
//| id: backend-syntax
//| file: src/backend/syntax/highlight.ts
import {
  type BundledLanguage,
  bundledLanguages,
  createCssVariablesTheme,
  createHighlighter,
  type Highlighter,
} from "shiki";

/** What a token is, as Shiki's CSS variables theme sorts tokens. */
export type SyntaxKind =
  | "keyword"
  | "string"
  | "string-expression"
  | "comment"
  | "constant"
  | "function"
  | "parameter"
  | "punctuation"
  | "link";

const KINDS: ReadonlySet<string> = new Set<SyntaxKind>([
  "keyword",
  "string",
  "string-expression",
  "comment",
  "constant",
  "function",
  "parameter",
  "punctuation",
  "link",
]);

/** A run of one line. `kind` is null for text in the default foreground. */
export interface SyntaxToken {
  text: string;
  kind: SyntaxKind | null;
}

/** One side of a file, a line at a time. Concatenating a line's tokens gives
 *  back that line exactly. */
export interface SourceFile {
  /** The Shiki language it was highlighted as, or null for plain text. */
  language: string | null;
  lines: SyntaxToken[][];
}

/** Extensions Shiki's language ids and aliases do not already cover. */
const EXTENSIONS: Record<string, BundledLanguage> = {
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  ex: "elixir",
  exs: "elixir",
  ml: "ocaml",
  mli: "ocaml",
  pl: "perl",
  svg: "xml",
};

function isBundled(name: string): name is BundledLanguage {
  return Object.hasOwn(bundledLanguages, name);
}

/** The language a path's name says it is in, or null when none is known. */
export function languageOf(path: string): BundledLanguage | null {
  const base = (path.split("/").at(-1) ?? path).toLowerCase();
  if (isBundled(base)) return base;

  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = base.slice(dot + 1);
  return EXTENSIONS[extension] ?? (isBundled(extension) ? extension : null);
}

const THEME = createCssVariablesTheme({
  name: "diffy",
  variablePrefix: "--shiki-",
});
const VARIABLE = /^var\(--shiki-token-([a-z-]+)\)$/;

export const MAX_HIGHLIGHT_BYTES = 512 * 1024;

let highlighter: Promise<Highlighter> | null = null;

/** The one highlighter, loading `language`'s grammar the first time it is asked for. */
async function highlighterFor(language: BundledLanguage): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [THEME], langs: [] });
  const ready = await highlighter;
  await ready.loadLanguage(language);
  return ready;
}

function kindOf(color: string | undefined): SyntaxKind | null {
  const kind = color?.match(VARIABLE)?.[1];
  return kind !== undefined && KINDS.has(kind) ? (kind as SyntaxKind) : null;
}

/** A file's lines, without the empty one after its final newline. */
function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function plain(text: string): SourceFile {
  return {
    language: null,
    lines: linesOf(text).map((line) =>
      line === "" ? [] : [{ text: line, kind: null }],
    ),
  };
}

/** `text`, highlighted as the language `path` names. */
export async function highlightSource(
  text: string,
  path: string,
): Promise<SourceFile> {
  const language = languageOf(path);
  if (language === null || text.length > MAX_HIGHLIGHT_BYTES) {
    return plain(text);
  }

  const { tokens } = (await highlighterFor(language)).codeToTokens(text, {
    lang: language,
    theme: THEME,
    tokenizeMaxLineLength: 2000,
  });
  if (text.endsWith("\n")) tokens.pop();

  return {
    language,
    lines: tokens.map((line) => {
      // Grammars split a line far finer than there are colours; merge
      // neighbours of one kind so each piece does not cost an element.
      const merged: SyntaxToken[] = [];
      for (const token of line) {
        const kind = kindOf(token.color);
        const last = merged.at(-1);
        if (last !== undefined && last.kind === kind)
          last.text += token.content;
        else merged.push({ text: token.content, kind });
      }
      return merged;
    }),
  };
}
```

## Test

The tests pin the contract the diff view relies on, that a line's tokens join
back into the line, not which kind a grammar picks.

```ts
//| id: backend-syntax-test
//| file: src/backend/syntax/highlight.test.ts
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
```
