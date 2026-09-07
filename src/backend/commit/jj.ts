// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[init]
import { $ } from "bun";
import * as z from "zod";

/** The `jj` CLI ran and exited non-zero — usually an unresolvable revset. */
export class JjError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "JjError";
  }
}

/** Keep jj's `Error:` lines; drop the "Done importing changes…" preamble. */
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

export interface JjLogEntry {
  commitId: string;
  changeId: string;
  description: string;
}

const JjLogEntryWire = z.object({
  commit_id: z.string(),
  change_id: z.string(),
  description: z.string(),
});

export interface JjLogOptions {
  revset?: string;
  limit?: number;
}

const LOG_TEMPLATE = 'json(self) ++ "\n"';

export async function jjLog(options: JjLogOptions = {}): Promise<JjLogEntry[]> {
  const args = ["log", "--no-graph", "-T", LOG_TEMPLATE];
  if (options.revset !== undefined) args.push("-r", options.revset);
  if (options.limit !== undefined) args.push("-n", String(options.limit));

  const output = await runJj(args);

  return Promise.all(
    output
      .split("\n")
      .filter((line) => line.length > 0)
      .map(async (line) => {
        const commit = await JjLogEntryWire.parseAsync(JSON.parse(line));

        return {
          commitId: commit.commit_id,
          changeId: commit.change_id,
          description: commit.description,
        };
      }),
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[2]

/** How one file changed between a revision and its parent. */
export type JjFileDiff = (
  | { status: "added" | "deleted" | "modified"; path: string }
  | { status: "renamed" | "copied"; oldPath: string; newPath: string }
) & {
  /** True when jj emitted "Binary files … differ" in place of a text hunk. */
  binary: boolean;
  /** The verbatim `git`-format unified diff for just this file. */
  patch: string;
};

export interface JjDiffOptions {
  /** Revision to diff against its parent(s). Defaults to `@`. */
  revision?: string;
}

export async function jjDiff(
  options: JjDiffOptions = {},
): Promise<JjFileDiff[]> {
  const revision = options.revision ?? "@";
  const output = await runJj([
    "diff",
    "--git",
    "--color=never",
    "-r",
    revision,
  ]);

  return splitFileDiffs(output).map(parseFileDiff);
}

const DIFF_HEADER = /^diff --git .*$/gm;

/** Split a multi-file `git` diff into one patch string per file. */
function splitFileDiffs(diff: string): string[] {
  const starts = [...diff.matchAll(DIFF_HEADER)].map((m) => m.index ?? 0);
  return starts.map((start, i) =>
    diff.slice(start, starts[i + 1] ?? diff.length),
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[3]

/** `a/foo` / `b/foo` -> `foo`; `/dev/null` -> `null`. */
function stripPrefix(raw: string): string | null {
  const path = raw.trim();
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

// Lazy first group so a path containing a space still splits at the real
// " b/" boundary; it only misfires if a path literally contains " b/".
const DIFF_GIT_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const BINARY_FILES = /^Binary files (.+) and (.+) differ$/;

/** Exported for unit tests: turn one file's `git`-format patch into metadata. */
export function parseFileDiff(patch: string): JjFileDiff {
  const lines = patch.split("\n");
  const header = lines[0]?.match(DIFF_GIT_HEADER);

  let kind: JjFileDiff["status"] = "modified";
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let binary = false;

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
      oldPath = stripPrefix(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      newPath = stripPrefix(line.slice(4));
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
    return { status: kind, oldPath, newPath, binary, patch };
  }

  const path = kind === "deleted" ? oldPath : newPath;
  if (path === null) {
    throw new Error(`jjDiff: can't parse a path from: ${lines[0]}`);
  }
  return { status: kind, path, binary, patch };
}
// ~/~ end
