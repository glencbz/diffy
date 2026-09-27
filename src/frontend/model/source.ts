// ~/~ begin <<docs/architecture/frontend/syntax.md#frontend-model-source>>[init]
import type { SourceFile } from "../api";

/** One side of a file, whole and highlighted, or null while there is none. */
export type SourceLookup = (blob: string, path: string) => SourceFile | null;
// ~/~ end
