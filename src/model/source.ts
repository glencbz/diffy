// ~/~ begin <<docs/architecture/backend/syntax.md#model-source>>[init]
import * as z from "zod";

/** What a token is, as Shiki's CSS variables theme sorts tokens. */
export const SyntaxKind = z.enum([
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
export type SyntaxKind = z.infer<typeof SyntaxKind>;

/** A run of one line. `kind` is null for text in the default foreground. */
export const SyntaxToken = z.object({
  text: z.string(),
  kind: SyntaxKind.nullable(),
});
export type SyntaxToken = z.infer<typeof SyntaxToken>;

/** One side of a file, a line at a time. Concatenating a line's tokens gives
 *  back that line exactly. */
export const SourceFile = z.object({
  /** The Shiki language it was highlighted as, or null for plain text. */
  language: z.string().nullable(),
  lines: z.array(z.array(SyntaxToken)),
});
export type SourceFile = z.infer<typeof SourceFile>;
// ~/~ end
