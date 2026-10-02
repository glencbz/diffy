# jj commit backend

Shells out to the [`jj`](https://jj-vcs.dev/) CLI. The only input diffy hands
jj is a revset, so a non-zero exit becomes a `JjError` carrying jj's message,
which routes answer as a 400; anything else, such as jj missing from `PATH`,
propagates as a 500.

```ts
//| id: jj-module
//| file: src/backend/commit/jj.ts
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
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
```

### Reading commit history

`jj log -T` with `json(self)` gives one JSON object per line, so nothing is
escaped by hand. Refs and markers are template keywords rather than commit
fields, so the template wraps `json(self)` and adds a `json(...)` per keyword:

```sh
jj log --no-graph -T '"{\"commit\":" ++ json(self) ++ ",\"bookmarks\":" ++ json(bookmarks) ++ "}\n"'
```

`bookmarks` and `tags` are the keywords `jj log`'s default template reads, so
a tracked remote ref shows only where it has drifted from its local one. Adding
a marker means adding it to `COMMIT_MARKERS` and `MARKER_KEYWORDS`; the
template, schema, and type follow. `current_working_copy` is a marker like the
others rather than a separate boolean, while `working_copies` stays a list of
workspace names.

```ts
//| id: jj-module

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
```

### Looking commits up by id

```ts
//| id: jj-module

/** Look up specific commits by id, keyed by commit id. */
export async function jjCommits(
  commitIds: string[],
): Promise<Map<string, JjLogEntry>> {
  if (commitIds.length === 0) return new Map();

  // Keyed, because jj answers a revset in topological order, not the order
  // asked. An unknown id fails the whole call.
  const entries = await jjLog({ revset: commitIds.join("|") });
  return new Map(entries.map((entry) => [entry.commitId, entry]));
}
```

### Reading past operations

`jjOpLog` feeds the operation picker; any operation id can go back to
`--at-operation` to view the repo just after it. The repo's first operation
has no command line, so `args` is `""` there.

```sh
jj op log --no-graph -T 'json(self) ++ "\n"'
```

```ts
//| id: jj-module

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
```

### Finding the repository

Every workspace of a repository shares one store. In the workspace that made
the repository `.jj/repo` is the store; in any other it is a file holding a
relative path to it. `jjRepoDir` follows that and resolves a real path, so
every workspace names the same directory.

```ts
//| id: jj-module

/** The real path of the repository store behind the current workspace,
 *  the same for every workspace of one repository. */
export async function jjRepoDir(): Promise<string> {
  const root = (await runJj(["workspace", "root"])).trim();
  const dotJj = join(root, ".jj");
  const repo = join(dotJj, "repo");
  const target = (await stat(repo)).isFile()
    ? resolve(dotJj, (await Bun.file(repo).text()).trim())
    : repo;
  return realpath(target);
}
```

### Reading a commit's diff

`jj diff --git` is the payload the UI renders. Hunks are not parsed here; the
output is split per file and each header gives the change kind, paths, and
blob ids. `diffFiles` does this for every jj command that prints a diff.

```ts
//| id: jj-module

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
```

The structural half reruns the same jj command with [`diffy
difft`](cli.md#difftastic-as-jjs-diff-tool) as its diff tool, the only way to
read an interdiff's before side, a tree no id names once jj exits. The tool is
configured on the command line so the reader's own jj config cannot change
what diffy shows. A structural diff never holds back the patch: a file without
one says why and keeps its patch.

```ts
//| id: jj-module

/** How to run `diffy`: a compiled executable is the command itself, and
 *  from source it is Bun running `cli.ts`. */
const DIFFY = import.meta.dir.startsWith("/$bunfs/")
  ? []
  : [`${import.meta.dir}/../../cli.ts`];

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
    `merge-tools.diffy-difft.diff-args=${JSON.stringify([...DIFFY, "difft", "$left", "$right"])}`,
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
```

```ts
//| id: jj-module

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

/** Exported for unit tests: turn one file's `git`-format patch into metadata.
 *  Paths come from `---`/`+++`, `rename`/`copy`, or `Binary files` lines; a
 *  patch with no path is a parser bug and throws. */
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
```

#### Test

The tests run the real CLI and assert on what holds in any history: the root
commit exists, sorts last in `all()`, and has the all-zero commit id and
all-`z` change id.

```ts
//| id: jj-module-test
//| file: src/backend/commit/jj.test.ts
import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import {
  COMMIT_MARKERS,
  JjError,
  jjCommits,
  jjDiff,
  jjDiffBetween,
  jjInterdiff,
  jjLog,
  jjOpLog,
  jjRepoDir,
  parseFileDiff,
} from "./jj";

describe("jjLog", () => {
  test("lists every commit, including the root", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "all()" });

    // assert
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry.commitId).toBe("string");
      expect(typeof entry.changeId).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(Array.isArray(entry.parents)).toBe(true);
      expect(typeof entry.author).toBe("string");
      expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
      for (const ref of entry.refs) expect(typeof ref.name).toBe("string");
      for (const marker of entry.markers) {
        expect(COMMIT_MARKERS).toContain(marker);
      }
    }

    const root = entries.at(-1);
    expect(root?.commitId).toBe("0".repeat(40));
    expect(root?.changeId).toBe("z".repeat(32));
    expect(root?.markers).toEqual(["empty"]);
    expect(root?.refs).toEqual([]);
  });

  test("marks the working copy and nothing else", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "all()" });

    // assert
    const here = entries.filter((entry) =>
      entry.markers.includes("working-copy"),
    );
    expect(here).toHaveLength(1);
    expect(here[0]?.commitId).toBe(
      (await jjLog({ revset: "@" }))[0]?.commitId as string,
    );
  });

  test("names the bookmarks pointing at a commit", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "bookmarks()" });

    // assert
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.refs.some((ref) => ref.kind === "bookmark")).toBe(true);
    }
  });

  test("respects the limit option", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "all()", limit: 1 });

    // assert
    expect(entries).toHaveLength(1);
  });

  test("wraps an unresolvable revset in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(
      jjLog({ revset: "no-such-revision-xyz" }),
    ).rejects.toBeInstanceOf(JjError);
  });

  test("wraps an unknown operation id in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(
      jjLog({ atOperation: "no-such-operation-xyz" }),
    ).rejects.toBeInstanceOf(JjError);
  });
});

/** The operation every jj repo starts from, always last in `jj op log`. */
const ROOT_OPERATION = "0".repeat(128);

describe("jjOpLog", () => {
  test("lists operations newest first, ending at the root operation", async () => {
    // arrange
    // act
    const operations = await jjOpLog();

    // assert
    expect(operations.length).toBeGreaterThan(1);
    expect(operations[0]?.id).not.toBe(ROOT_OPERATION);
    expect(operations.at(-1)?.id).toBe(ROOT_OPERATION);
  });

  test("respects the limit option", async () => {
    // arrange
    // act
    const operations = await jjOpLog({ limit: 1 });

    // assert
    expect(operations).toHaveLength(1);
  });
});

describe("jjRepoDir", () => {
  test("names the store directory behind this workspace", async () => {
    // arrange
    // act
    const dir = await jjRepoDir();

    // assert
    expect(dir.endsWith("/.jj/repo")).toBe(true);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});
```

`parseFileDiff` runs on trimmed real `jj diff --git` output.

```ts
//| id: jj-module-test

describe("parseFileDiff", () => {
  test("added text file", () => {
    // arrange
    const patch = [
      "diff --git a/add.txt b/add.txt",
      "new file mode 100644",
      "index 0000000000..d5a09df94c",
      "--- /dev/null",
      "+++ b/add.txt",
      "@@ -0,0 +1,1 @@",
      "+brand new",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "added",
      path: "add.txt",
      binary: false,
      oldBlob: null,
      newBlob: "d5a09df94c",
    });
  });

  test("deleted text file", () => {
    // arrange
    const patch = [
      "diff --git a/del.txt b/del.txt",
      "deleted file mode 100644",
      "index de980441c3..0000000000",
      "--- a/del.txt",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "deleted",
      path: "del.txt",
      binary: false,
      oldBlob: "de980441c3",
      newBlob: null,
    });
  });

  test("modified text file", () => {
    // arrange
    const patch = [
      "diff --git a/mod.txt b/mod.txt",
      "index 04ec35a6dc..0722639108 100644",
      "--- a/mod.txt",
      "+++ b/mod.txt",
      "@@ -1,3 +1,4 @@",
      " x",
      "+new line",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "modified",
      path: "mod.txt",
      binary: false,
      oldBlob: "04ec35a6dc",
      newBlob: "0722639108",
    });
  });

  test("rename with no ---/+++ lines", () => {
    // arrange
    const patch = [
      "diff --git a/t.txt b/renamed.txt",
      "rename from t.txt",
      "rename to renamed.txt",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toEqual({
      status: "renamed",
      oldPath: "t.txt",
      newPath: "renamed.txt",
      binary: false,
      oldBlob: null,
      newBlob: null,
      patch,
    });
  });

  test("binary modification", () => {
    // arrange
    const patch = [
      "diff --git a/b.bin b/b.bin",
      "index cc232b734a..95d534dc0b 100644",
      "Binary files a/b.bin and b/b.bin differ",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "modified",
      path: "b.bin",
      binary: true,
    });
  });

  test("binary addition (only the new side exists)", () => {
    // arrange
    const patch = [
      "diff --git a/addbin.bin b/addbin.bin",
      "new file mode 100644",
      "index 0000000000..73d04aa0b2",
      "Binary files /dev/null and b/addbin.bin differ",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "added",
      path: "addbin.bin",
      binary: true,
    });
  });
});

describe("jjDiff", () => {
  test("parses the first commit as a set of added files", async () => {
    // arrange
    // act
    const files = await jjDiff({ revision: "root()+" });

    // assert
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.status).toBe("added");
      expect(file.patch.startsWith("diff --git ")).toBe(true);
    }
  });

  test("reads every modified file through difftastic as well", async () => {
    // arrange
    // act
    const files = await jjDiff({ revision: "root()++" });

    // assert
    const modified = files.filter((file) => file.status === "modified");
    expect(modified.length).toBeGreaterThan(0);
    for (const file of modified) {
      expect(file.structural.kind).toBe("structural");
    }
    for (const file of files.filter((file) => file.status === "added")) {
      expect(file.structural).toEqual({
        kind: "unavailable",
        reason: "added file",
      });
    }
  });

  test("returns an empty list for a commit with no changes", async () => {
    // arrange
    // act
    // assert
    expect(await jjDiff({ revision: "root()" })).toEqual([]);
  });

  test("wraps an unresolvable revision in JjError", async () => {
    // arrange
    const attempt = () => jjDiff({ revision: "no-such-revision-xyz" });

    // act
    // assert
    await expect(attempt()).rejects.toBeInstanceOf(JjError);
    await expect(attempt()).rejects.toThrow(/doesn't exist/);
  });
});
```

### Comparing two commits

`jj interdiff --from A --to B` rebases A onto B's parents before comparing,
so a commit that was only rebased reads as no change, unlike `jj diff --from
--to`. The two ends are full commit ids, which jj resolves even when no current
view lists them, so they can come from two different operations with no
`--at-operation`. A change id would name whichever version the current view
holds. The synthetic `JJ-COMMIT-DESCRIPTION` file it emits for a reworded
message is passed through as an ordinary file.

```ts
//| id: jj-module

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
```

`jjDiffBetween` compares trees: everything between the two revisions,
including commits that landed in between. Two versions of one branch want the
interdiff, since the tree diff is mostly the rebase; a branch against the
commit it was cut from wants the tree diff.

```ts
//| id: jj-module

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
```


#### Test

The cross-operation test compares a commit id from the repo's oldest
operation against the current view, passing no operation.

```ts
//| id: jj-module-test

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

describe("jjCommits", () => {
  test("keys the requested commits by commit id", async () => {
    // arrange
    const entries = await jjLog({ revset: "all()", limit: 3 });
    const ids = entries.map((entry) => entry.commitId);

    // act
    const found = await jjCommits(ids);

    // assert
    expect([...found.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(found.get(id)?.commitId).toBe(id);
  });

  test("asks jj nothing when given no ids", async () => {
    // arrange
    // act
    // assert
    expect(await jjCommits([])).toEqual(new Map());
  });
});

describe("jjInterdiff", () => {
  test("reports no difference between a commit and itself", async () => {
    // arrange
    const id = await commitId("root()+");

    // act
    // assert
    expect(await jjInterdiff({ from: id, to: id })).toEqual([]);
  });

  test("reports the difference between two unrelated changes", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const files = await jjInterdiff({ from, to });

    // assert
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.patch.startsWith("diff --git ")).toBe(true);
    }
  });

  test("compares a commit from an old operation without --at-operation", async () => {
    // arrange
    const operations = await jjOpLog();
    const oldest = operations.at(-1);
    const [before] = await jjLog({
      revset: "all()",
      limit: 1,
      atOperation: oldest?.id,
    });
    if (before === undefined) throw new Error("no commit at the oldest op");

    // act
    const files = await jjInterdiff({
      from: before.commitId,
      to: await commitId("@"),
    });

    // assert
    expect(Array.isArray(files)).toBe(true);
  });
});
```

The second case runs both comparisons over one pair, since the risk is a
caller reaching for the wrong one and getting a plausible answer.

```ts
//| id: jj-module-test

describe("jjDiffBetween", () => {
  test("gives a commit's own diff when the before side is its parent", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const files = await jjDiffBetween({ from, to });

    // assert
    expect(files).toEqual(await jjDiff({ revision: to }));
  });
});
```
