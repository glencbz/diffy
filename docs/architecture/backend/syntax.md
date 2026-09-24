# Syntax highlighting

A patch shows a file in fragments, and a fragment cannot be highlighted on its
own. A hunk that opens inside a multi-line string or a block comment reads as
code to anything that sees only the hunk. So the server highlights whole
files, one side at a time, and the diff view picks the lines it needs out of
the result.

[Shiki](https://shiki.style/) does the highlighting. It runs the TextMate
grammars VS Code uses, so the languages it knows and the way it splits a line
are the ones most readers already see in their editor, and it runs in Bun with
no build step. Tree-sitter would give a syntax tree as well as colours, and
nothing here needs a tree.

## Colours are kinds, not colours

Shiki normally resolves every token to a colour out of a theme. Its CSS
variables theme resolves a token to a variable name instead, such as
`var(--shiki-token-keyword)`, out of a short fixed list. `highlightSource`
strips that down to the kind, `keyword`, and the frontend decides what a
keyword looks like in [its own tokens](../frontend/tokens.md). The app's light
and dark themes then colour code the way they colour everything else, and a
highlighted file is the same answer whichever theme asks for it.

A token in the default foreground has no kind. Neighbouring tokens of the same
kind are merged, because the grammar splits a line far finer than there are
colours to tell the pieces apart, and each piece would otherwise cost an
element in the page.

## Which language

A file's language comes from its name. A whole basename that Shiki knows,
such as `justfile` or `Dockerfile`, wins over an extension, and otherwise the
extension is looked up among Shiki's language ids and aliases, which cover
most extensions as they are written. `EXTENSIONS` holds the common ones they
miss. A file whose language is unknown still gets its lines back, as plain
text, because the diff view uses the lines for more than colour.

## What it costs

The first file in a language loads that language's grammar, and the first
file of all starts the highlighter, so both are done once per process and
shared. Highlighting itself is synchronous and holds the event loop for as
long as it takes, so a file past `MAX_HIGHLIGHT_BYTES` comes back plain rather
than making every other request wait on it. `tokenizeMaxLineLength` does the
same for a single long line, such as a minified bundle's.

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

The highlighter is real rather than mocked. What is worth pinning is the
contract the diff view leans on, that a line's tokens join back into the line,
and not which kind a grammar gives any one token, which is Shiki's business.

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
