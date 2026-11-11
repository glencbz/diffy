// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-diff>>[init]
import * as z from "zod";
import { LogEntry } from "./history";

/** A token difftastic says changed: a range of UTF-16 code units in `code`. */
export const ChangedRange = z.object({ start: z.number(), end: z.number() });
export type ChangedRange = z.infer<typeof ChangedRange>;

/** A line of a structural hunk. Numbers count from 1, as a patch's do. */
export const StructuralLine = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("context"),
    code: z.string(),
    newLine: z.number(),
    oldLine: z.number().optional(),
  }),
  z.object({
    kind: z.literal("removed"),
    code: z.string(),
    oldLine: z.number(),
    changes: z.array(ChangedRange),
  }),
  z.object({
    kind: z.literal("added"),
    code: z.string(),
    newLine: z.number(),
    changes: z.array(ChangedRange),
  }),
]);
export type StructuralLine = z.infer<typeof StructuralLine>;

export const StructuralHunk = z.object({
  /** A `@@ -a,b +c,d @@` line, so both views label a hunk the same way. */
  header: z.string(),
  /** The after-side number of the hunk's first line, or of the line that
   *  would follow it when the hunk only removes. */
  newStart: z.number(),
  /** The same on the before side. */
  oldStart: z.number(),
  lines: z.array(StructuralLine),
});
export type StructuralHunk = z.infer<typeof StructuralHunk>;

/** A file as [difftastic](../backend/difft.md) reads it: hunks in the same
 *  shape a patch reads into, with each changed line's ranges, or why the
 *  file has none. */
export const StructuralDiff = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structural"),
    language: z.string(),
    hunks: z.array(StructuralHunk),
  }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type StructuralDiff = z.infer<typeof StructuralDiff>;

const served = {
  /** True when jj emitted "Binary files ... differ" in place of a text hunk. */
  binary: z.boolean(),
  /** The git blob each side's contents are stored under, as abbreviated on
   *  the `index` line. Null for a side that does not exist, and for both
   *  sides when the patch has no `index` line at all. */
  oldBlob: z.string().nullable(),
  newBlob: z.string().nullable(),
  /** The verbatim `git`-format unified diff for just this file. */
  patch: z.string(),
  structural: StructuralDiff,
};
const onePath = { path: z.string(), ...served };
const twoPaths = { oldPath: z.string(), newPath: z.string(), ...served };

/** How one file changed between two trees: its patch, and the same change
 *  as difftastic reads it or why it cannot. This is what the server sends. */
export const ServedFileDiff = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), ...onePath }),
  z.object({ status: z.literal("deleted"), ...onePath }),
  z.object({ status: z.literal("modified"), ...onePath }),
  z.object({ status: z.literal("renamed"), ...twoPaths }),
  z.object({ status: z.literal("copied"), ...twoPaths }),
]);
export type ServedFileDiff = z.infer<typeof ServedFileDiff>;

/** A served file before difftastic has read it. */
export type PatchFile = ServedFileDiff extends infer File
  ? File extends unknown
    ? Omit<File, "structural">
    : never
  : never;

type TwoPaths = Extract<ServedFileDiff, { oldPath: string }>;

/** A served file, or a pair of paths the reader chose to compare. The
 *  server never sends `compared`. */
export type FileDiff =
  | ServedFileDiff
  | (Omit<TwoPaths, "status"> & { status: "compared" });

export const InterdiffRow = z.object({
  from: LogEntry.nullable(),
  to: LogEntry.nullable(),
  files: z.array(ServedFileDiff),
});
export type InterdiffRow = {
  from: LogEntry | null;
  to: LogEntry | null;
  files: FileDiff[];
};

export const InterdiffResponse = z.object({ rows: z.array(InterdiffRow) });
export type InterdiffResponse = { rows: InterdiffRow[] };
// ~/~ end
