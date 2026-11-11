// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-history>>[init]
import * as z from "zod";

/** A full 40-hex git object id. Abbreviations are refused. Branded: only a
 *  parse mints one. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

/** A git blob id, whole or abbreviated the way a patch's `index` line prints it. */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{4,64}$/, "expected a hex git blob id")
  .brand("BlobId");
export type BlobId = z.infer<typeof BlobId>;

/** A name `jj log` prints beside a commit. */
export const CommitRef = z.object({
  kind: z.enum(["bookmark", "tag", "working-copy"]),
  /** The name jj shows: `name`, or `name@remote` for a drifted remote ref. */
  name: z.string(),
});
export type CommitRef = z.infer<typeof CommitRef>;

/** The standings `jj log` reports about a commit, in the order jj shows them. */
export const COMMIT_MARKERS = [
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
] as const;
export const CommitMarker = z.enum(COMMIT_MARKERS);
export type CommitMarker = z.infer<typeof CommitMarker>;

export const LogEntry = z.object({
  commitId: z.string(),
  /** Null for a commit that jj did not read, which has no change id. */
  changeId: z.string().nullable(),
  description: z.string(),
  /** Parent commit IDs, in jj's order. Empty only for the root commit. */
  parents: z.array(z.string()),
  /** The author's email, the identity `jj log` prints. */
  author: z.string(),
  /** ISO 8601 committer timestamp, the time `jj log` prints. */
  timestamp: z.string(),
  /** Bookmarks, then tags, then working copies, as `jj log` orders them. */
  refs: z.array(CommitRef),
  markers: z.array(CommitMarker),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** One entry from `jj op log`: a recorded mutation of the repo. */
export const OpLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  /** ISO 8601 time the operation finished. */
  time: z.string(),
  /** The `jj` command line that produced the operation. */
  args: z.string(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-history>>[1]

/** A view of the local repo: the jj operation to read its log at. */
export type JjSource = { kind: "jj"; operation: string | null };

/** One version of a local review, named by the commits it registered. */
export type LocalSource = { kind: "local"; commits: string[] };

/** Where one side's commits come from. */
export type Source = JjSource | LocalSource;

/** One commit of a registered version. */
export const GitCommit = z.object({
  commitId: GitOid,
  parents: z.array(GitOid),
  /** Full commit message, subject and body, as `LogEntry.description`. */
  description: z.string(),
  author: z.string(),
  /** ISO 8601 author date. */
  authoredAt: z.string(),
  /** What lines this commit up against another across a rewrite: its jj
   *  change id, or null when it has none. */
  changeId: z.string().nullable(),
});
export type GitCommit = z.infer<typeof GitCommit>;
// ~/~ end
