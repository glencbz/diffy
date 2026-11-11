// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-diff>>[init]
import type { LogEntry } from "./history";

/** A token difftastic says changed, in UTF-16 code units of its line. */
export type ChangedRange = { start: number; end: number };

export type StructuralLine =
  | { kind: "context"; code: string; newLine: number; oldLine?: number }
  | { kind: "removed"; code: string; oldLine: number; changes: ChangedRange[] }
  | { kind: "added"; code: string; newLine: number; changes: ChangedRange[] };

export type StructuralHunk = {
  header: string;
  newStart: number;
  oldStart: number;
  lines: StructuralLine[];
};

/** A file as [difftastic](../backend/difft.md) reads it: hunks in the same
 *  shape a patch reads into, with each changed line's ranges, or why the
 *  file has none. */
export type StructuralDiff =
  | { kind: "structural"; language: string; hunks: StructuralHunk[] }
  | { kind: "unavailable"; reason: string };

type FileDiffFields = {
  binary: boolean;
  /** The blob each side is stored under, for `fetchSource`. Null for a side
   *  that does not exist. */
  oldBlob: string | null;
  newBlob: string | null;
  patch: string;
  structural: StructuralDiff;
};

export type FileDiff = FileDiffFields &
  (
    | { status: "added" | "deleted" | "modified"; path: string }
    | {
        /** `compared` is a pair the reader chose; the server never sends it. */
        status: "renamed" | "copied" | "compared";
        oldPath: string;
        newPath: string;
      }
  );

export type InterdiffRow = {
  from: LogEntry | null;
  to: LogEntry | null;
  files: FileDiff[];
};

export type InterdiffResponse = { rows: InterdiffRow[] };
// ~/~ end
