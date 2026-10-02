// ~/~ begin <<docs/architecture/frontend/syntax.md#frontend-model-source>>[init]
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

export type SyntaxToken = { text: string; kind: SyntaxKind | null };

export type SourceFile = { language: string | null; lines: SyntaxToken[][] };

/** One side of a file, whole and highlighted, or null while there is none. */
export type SourceLookup = (blob: string, path: string) => SourceFile | null;
// ~/~ end
