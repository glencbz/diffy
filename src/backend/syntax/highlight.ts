// ~/~ begin <<docs/architecture/backend/syntax.md#backend-syntax>>[init]
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
// ~/~ end
