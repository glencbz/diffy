// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[init]
import { $ } from "bun";
import * as z from "zod";
import { type StructuralDiff, StructuralDiffs } from "./difft";

/** The `jj` CLI ran and exited non-zero, usually an unresolvable revset. */
export class JjError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "JjError";
  }
}

/** Keep jj's `Error:` lines; drop the "Done importing changes" preamble. */
function cleanStderr(stderr: string): string {
  const errors = stderr.split("\n").filter((line) => line.startsWith("Error:"));
  return (errors.length > 0 ? errors.join("\n") : stderr).trim();
}

async function runJj(args: string[]): Promise<string> {
  try {
    return await $`jj ${args}`.quiet().text();
  } catch (error) {
    if (error instanceof $.ShellError) {
      const message =
        cleanStderr(error.stderr.toString()) || `jj exited ${error.exitCode}`;
      throw new JjError(message, error.exitCode);
    }
    throw error;
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[1]

/** A name `jj log` prints beside a commit. */
export interface CommitRef {
  kind: "bookmark" | "tag" | "working-copy";
  /** The name jj shows: `name`, or `name@remote` for a drifted remote ref. */
  name: string;
}

/** The standings `jj log` reports about a commit, in the order jj shows them. */
export const COMMIT_MARKERS = [
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
] as const;
export type CommitMarker = (typeof COMMIT_MARKERS)[number];

const MARKER_KEYWORDS = {
  "working-copy": "current_working_copy",
  empty: "empty",
  conflict: "conflict",
  divergent: "divergent",
  hidden: "hidden",
} satisfies Record<CommitMarker, string>;

export interface JjLogEntry {
  commitId: string;
  changeId: string;
  description: string;
  /** Parent commit IDs, in jj's order. Empty only for the root commit. */
  parents: string[];
  /** The author's email, the identity `jj log` prints. */
  author: string;
  /** ISO 8601 committer timestamp, the time `jj log` prints. */
  timestamp: string;
  /** Bookmarks, then tags, then working copies, as `jj log` orders them. */
  refs: CommitRef[];
  markers: CommitMarker[];
}

const CommitRefWire = z.object({
  name: z.string(),
  remote: z.string().optional(),
});
type CommitRefWire = z.infer<typeof CommitRefWire>;

const JjLogEntryWire = z.object({
  commit: z.object({
    commit_id: z.string(),
    change_id: z.string(),
    description: z.string(),
    parents: z.array(z.string()),
    author: z.object({ email: z.string() }),
    committer: z.object({ timestamp: z.string() }),
  }),
  bookmarks: z.array(CommitRefWire),
  tags: z.array(CommitRefWire),
  working_copies: z.array(z.string()),
  markers: z.object({
    "working-copy": z.boolean(),
    empty: z.boolean(),
    conflict: z.boolean(),
    divergent: z.boolean(),
    hidden: z.boolean(),
  }),
});
type JjLogEntryWire = z.infer<typeof JjLogEntryWire>;

export interface JjLogOptions {
  revset?: string;
  limit?: number;
  /** Repo operation id to view the log at, via `jj log --at-operation`. */
  atOperation?: string;
}

const LOG_TEMPLATE = [
  '"{\\"commit\\":" ++ json(self)',
  '++ ",\\"bookmarks\\":" ++ json(bookmarks)',
  '++ ",\\"tags\\":" ++ json(tags)',
  '++ ",\\"working_copies\\":" ++ json(working_copies.map(|wc| wc.name()))',
  '++ ",\\"markers\\":{"',
  COMMIT_MARKERS.map(
    (marker) => `++ "\\"${marker}\\":" ++ json(${MARKER_KEYWORDS[marker]})`,
  ).join(' ++ "," '),
  '++ "}}\\n"',
].join(" ");

function refName(ref: CommitRefWire): string {
  return ref.remote === undefined ? ref.name : `${ref.name}@${ref.remote}`;
}

function refsOf(entry: JjLogEntryWire): CommitRef[] {
  return [
    ...entry.bookmarks.map((ref) => ({
      kind: "bookmark" as const,
      name: refName(ref),
    })),
    ...entry.tags.map((ref) => ({ kind: "tag" as const, name: refName(ref) })),
    ...entry.working_copies.map((name) => ({
      kind: "working-copy" as const,
      name,
    })),
  ];
}

export async function jjLog(options: JjLogOptions = {}): Promise<JjLogEntry[]> {
  const args = ["log", "--no-graph", "-T", LOG_TEMPLATE];
  if (options.revset !== undefined) args.push("-r", options.revset);
  if (options.limit !== undefined) args.push("-n", String(options.limit));
  if (options.atOperation !== undefined) {
    args.push("--at-operation", options.atOperation);
  }

  const output = await runJj(args);

  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const entry = JjLogEntryWire.parse(JSON.parse(line));
      const { commit } = entry;

      return {
        commitId: commit.commit_id,
        changeId: commit.change_id,
        description: commit.description,
        parents: commit.parents,
        author: commit.author.email,
        timestamp: commit.committer.timestamp,
        refs: refsOf(entry),
        markers: COMMIT_MARKERS.filter((marker) => entry.markers[marker]),
      };
    });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[2]

/** Look up specific commits by id, keyed by commit id. */
export async function jjCommits(
  commitIds: string[],
): Promise<Map<string, JjLogEntry>> {
  if (commitIds.length === 0) return new Map();

  const entries = await jjLog({ revset: commitIds.join("|") });
  return new Map(entries.map((entry) => [entry.commitId, entry]));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[3]

/** One entry from `jj op log`: a recorded mutation of the repo. */
export interface JjOpLogEntry {
  id: string;
  description: string;
  /** ISO 8601 time the operation finished. */
  time: string;
  /** The `jj` command line that produced the operation. */
  args: string;
}

const JjOpLogEntryWire = z.object({
  id: z.string(),
  description: z.string(),
  time: z.object({ end: z.string() }),
  attributes: z.object({ args: z.string().optional() }).optional(),
});

export interface JjOpLogOptions {
  limit?: number;
}

const OP_LOG_TEMPLATE = 'json(self) ++ "\n"';

export async function jjOpLog(
  options: JjOpLogOptions = {},
): Promise<JjOpLogEntry[]> {
  const args = ["op", "log", "--no-graph", "-T", OP_LOG_TEMPLATE];
  if (options.limit !== undefined) args.push("-n", String(options.limit));

  const output = await runJj(args);

  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const op = JjOpLogEntryWire.parse(JSON.parse(line));
      return {
        id: op.id,
        description: op.description,
        time: op.time.end,
        args: op.attributes?.args ?? "",
      };
    });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[4]

/** How one file changed between a revision and its parent, as its patch says. */
export type JjPatchFile = (
  | { status: "added" | "deleted" | "modified"; path: string }
  | { status: "renamed" | "copied"; oldPath: string; newPath: string }
) & {
  /** True when jj emitted "Binary files ... differ" in place of a text hunk. */
  binary: boolean;
  /** The git blob each side's contents are stored under, as abbreviated on
   *  the `index` line. Null for a side that does not exist, and for both
   *  sides when the patch has no `index` line at all. */
  oldBlob: string | null;
  newBlob: string | null;
  /** The verbatim `git`-format unified diff for just this file. */
  patch: string;
};

/** A file's patch, and the same change as difftastic reads it or why it
 *  cannot. */
export type JjFileDiff = JjPatchFile & { structural: StructuralDiff };

export interface JjDiffOptions {
  /** Revision to diff against its parent(s). Defaults to `@`. */
  revision?: string;
  /** Repo operation id to resolve the revision at, via `--at-operation`. */
  atOperation?: string;
}

export function jjDiff(options: JjDiffOptions = {}): Promise<JjFileDiff[]> {
  const revision = options.revision ?? "@";
  const args = ["diff", "-r", revision];
  if (options.atOperation !== undefined) {
    args.push("--at-operation", options.atOperation);
  }

  return diffFiles(args);
}

const DIFF_HEADER = /^diff --git .*$/gm;

/** Split a multi-file `git` diff into one patch string per file. */
function splitFileDiffs(diff: string): string[] {
  const starts = [...diff.matchAll(DIFF_HEADER)].map((m) => m.index ?? 0);
  return starts.map((start, i) =>
    diff.slice(start, starts[i + 1] ?? diff.length),
  );
}

/** Run a jj diff command both ways, one file at a time: as a `git`-format
 *  patch, and through difftastic. */
async function diffFiles(args: string[]): Promise<JjFileDiff[]> {
  const [patch, structural] = await Promise.all([
    runJj([...args, "--git", "--color=never"]),
    structuralDiffs(args),
  ]);

  return splitFileDiffs(patch).map((text) => {
    const file = parseFileDiff(text);
    return { ...file, structural: structuralFor(file, structural) };
  });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[5]

const DIFFT_TOOL = `${import.meta.dir}/difft.ts`;

/** Every changed file as difftastic reads it, by path, or why there is
 *  nothing to read. */
async function structuralDiffs(
  args: string[],
): Promise<Record<string, StructuralDiff> | string> {
  const output = await runJj([
    ...args,
    "--tool",
    "diffy-difft",
    "--config",
    `merge-tools.diffy-difft.program=${JSON.stringify(process.execPath)}`,
    "--config",
    `merge-tools.diffy-difft.diff-args=${JSON.stringify([DIFFT_TOOL, "$left", "$right"])}`,
  ]);

  try {
    return StructuralDiffs.parse(JSON.parse(output));
  } catch {
    return "difftastic's answer could not be read";
  }
}

function structuralFor(
  file: JjPatchFile,
  answer: Record<string, StructuralDiff> | string,
): StructuralDiff {
  const unavailable = (reason: string) =>
    ({ kind: "unavailable", reason }) as const;

  if (typeof answer === "string") return unavailable(answer);
  if (file.binary) return unavailable("binary file");
  if (!("path" in file)) return unavailable(`${file.status} file`);
  if (file.status !== "modified") {
    return unavailable(`${file.status} file`);
  }
  return (
    answer[file.path] ?? unavailable("jj did not hand this file to difftastic")
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[6]

/** `a/foo` / `b/foo` -> `foo`; `/dev/null` -> `null`. */
function stripPrefix(raw: string): string | null {
  const path = raw.trim();
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

// Lazy first group so a path containing a space still splits at the real
// " b/" boundary; it only misfires if a path literally contains " b/".
const DIFF_GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const BINARY_FILES = /^Binary files (.+) and (.+) differ$/;
const INDEX = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/;

/** A blob id off the `index` line, or null for the all-zeros missing side. */
function blobOf(id: string | undefined): string | null {
  return id === undefined || /^0+$/.test(id) ? null : id;
}

/** Exported for unit tests: turn one file's `git`-format patch into metadata. */
export function parseFileDiff(patch: string): JjPatchFile {
  const lines = patch.split("\n");
  const header = lines[0]?.match(DIFF_GIT_HEADER);

  let kind: JjPatchFile["status"] = "modified";
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let binary = false;
  let oldBlob: string | null = null;
  let newBlob: string | null = null;

  for (const line of lines) {
    if (line.startsWith("new file mode")) kind = "added";
    else if (line.startsWith("deleted file mode")) kind = "deleted";
    else if (line.startsWith("rename from ")) {
      kind = "renamed";
      oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      kind = "renamed";
      newPath = line.slice("rename to ".length);
    } else if (line.startsWith("copy from ")) {
      kind = "copied";
      oldPath = line.slice("copy from ".length);
    } else if (line.startsWith("copy to ")) {
      kind = "copied";
      newPath = line.slice("copy to ".length);
    } else if (line.startsWith("--- ")) {
      oldPath = stripPrefix(line.slice("--- ".length));
    } else if (line.startsWith("+++ ")) {
      newPath = stripPrefix(line.slice("+++ ".length));
    } else if (line.startsWith("index ")) {
      const ids = line.match(INDEX);
      oldBlob = blobOf(ids?.[1]);
      newBlob = blobOf(ids?.[2]);
    } else if (line.startsWith("Binary files ")) {
      binary = true;
      const paths = line.match(BINARY_FILES);
      if (paths?.[1] !== undefined) oldPath ??= stripPrefix(paths[1]);
      if (paths?.[2] !== undefined) newPath ??= stripPrefix(paths[2]);
    }
  }

  // Mode-only changes carry no per-side path line; the header is the last resort.
  if (kind !== "added") oldPath ??= header?.[1] ?? null;
  if (kind !== "deleted") newPath ??= header?.[2] ?? null;

  if (kind === "renamed" || kind === "copied") {
    if (oldPath === null || newPath === null) {
      throw new Error(`jjDiff: can't parse rename paths from: ${lines[0]}`);
    }
    return { status: kind, oldPath, newPath, binary, oldBlob, newBlob, patch };
  }

  const path = kind === "deleted" ? oldPath : newPath;
  if (path === null) {
    throw new Error(`jjDiff: can't parse a path from: ${lines[0]}`);
  }
  return { status: kind, path, binary, oldBlob, newBlob, patch };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[7]

export interface JjInterdiffOptions {
  /** Commit id whose change is the "before" side. */
  from: string;
  /** Commit id whose change is the "after" side. */
  to: string;
}

export function jjInterdiff(
  options: JjInterdiffOptions,
): Promise<JjFileDiff[]> {
  return diffFiles(["interdiff", "--from", options.from, "--to", options.to]);
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[8]

export interface JjDiffBetweenOptions {
  /** Revision whose tree is the "before" side. */
  from: string;
  /** Revision whose tree is the "after" side. */
  to: string;
}

export function jjDiffBetween(
  options: JjDiffBetweenOptions,
): Promise<JjFileDiff[]> {
  return diffFiles(["diff", "--from", options.from, "--to", options.to]);
}
// ~/~ end
