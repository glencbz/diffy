# jj commit backend

We'll use jj as our primary commit backend. This shells out to the
[`jj`](https://jj-vcs.dev/) CLI rather than linking to the library. Per the
[tech plan](../../tech-plan.md) that's the more stable surface.

## Functionality

### Running the CLI

Every jj invocation goes through one helper, so the shell call and its error
contract live in a single place. Bun's `$` throws a `ShellError` when the
process exits non-zero. The only external input we ever hand jj is a revset,
so a non-zero exit almost always means the caller passed a bad one, and we
surface that as a typed `JjError` carrying jj's own stderr message (minus the
"Done importing changes" progress line jj also writes to stderr). Anything
that is not a `ShellError`, such as jj missing from `PATH`, is a genuine fault
and propagates untouched for the caller to turn into a 500.

```ts
//| id: jj-module
//| file: src/backend/commit/jj.ts
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

`jj log` supports a `-T`/`--template` expression language. The builtin
`json(self)` function serializes a commit to JSON (stable field names:
`commit_id`, `change_id`, `description`, `parents`, `author`, `committer`),
so instead of hand-building a delimited/escaped template we emit one JSON
object per line (JSONL) and let `JSON.parse` do the work. We keep
`parents` (the list of parent commit IDs) so the frontend can draw the
commit graph and mark merges.

A commit carries more than `json(self)` reaches. The names pointing at a
commit and the standings jj reports about it are keywords of the template
language rather than fields of the commit, so the template wraps `json(self)`
in an object of its own and adds one `json(...)` per keyword. jj still does
every serialization, so no string is escaped by hand.

```sh
jj log --no-graph -T '"{\"commit\":" ++ json(self) ++ ",\"bookmarks\":" ++ json(bookmarks) ++ "}\n"'
```

`bookmarks` and `tags` are the keywords `jj log`'s own default template reads,
so a tracked remote ref appears only where it has drifted from its local one
and the log names a commit the way a terminal would. A remote ref serializes
with a `remote` field alongside its `name`, and `name@remote` is how jj writes
that pair. `working_copies` serializes a whole commit per workspace, which is
the commit the row already is, so the template maps it down to the workspace
name before jj gets to it.

`--no-graph` drops the ASCII-art graph column so each line of stdout is
exactly one commit's output.

`atOperation` maps to `jj log --at-operation <id>`, which rebuilds the repo
view as it stood just after that operation. It is how the UI shows a
historical version of the log (see [reading past operations](#reading-past-operations)).

A marker is a boolean keyword. `COMMIT_MARKERS` is the ordered list of them
and `MARKER_KEYWORDS` says which keyword each one reads, so the template's
field set, the wire schema's field set and the entry's type all come from the
same pair and a sixth marker is two lines rather than another branch in the
parser and another optional field on the entry.

`current_working_copy` is a marker here though `jj log` spends its glyph
column on it. It is a standing a commit either has or does not, which is what
the other four are, and the alternative is one boolean threaded to one render
site for the sake of the placement. `working_copies` is a different question
and stays a list of names: it answers which workspaces sit here, and jj leaves
it empty until a repository has more than one.

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

Picking a commit out of the graph gives us its commit id; captioning it later
needs the rest of its metadata back. `jjCommits` resolves a batch of ids in
one `jj log` call by joining them into a `|` revset. It keys the result by
commit id rather than returning a list, because jj answers a revset in
topological order, not in the order it was asked. An id jj can't resolve
fails the whole call, which is the right answer for a caller that made one up.

```ts
//| id: jj-module

/** Look up specific commits by id, keyed by commit id. */
export async function jjCommits(
  commitIds: string[],
): Promise<Map<string, JjLogEntry>> {
  if (commitIds.length === 0) return new Map();

  const entries = await jjLog({ revset: commitIds.join("|") });
  return new Map(entries.map((entry) => [entry.commitId, entry]));
}
```

### Reading past operations

jj records every repo mutation as an *operation*. `jj op log` lists them,
newest first, and any operation's id can be fed back to `--at-operation` to
view the repo as it was right after that step. `jjOpLog` is the picker's data
source: the same `json(self)` JSONL trick as `jjLog`, reading an `Operation`
rather than a `Commit`, so the keywords differ (`id`, `time`, `description`,
and `attributes.args`, the command line that caused it). The one operation
without a command line is the repo's first, `initialize repo`, so `args` is
optional and reported as `""` there.

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

### Reading a commit's diff

`jj diff --git -r <revision>` prints a standard `git`-format unified diff of a
revision against its parent. That is the "show a commit's diff" operation the
[tech plan](../../tech-plan.md) calls for, and `--color=never` keeps the output
free of ANSI escapes.

We don't parse hunks: the raw `--git` patch is the payload a review UI renders.
We only split the combined output into one entry per file and read the
metadata the UI needs off each file's header, namely the change kind and the
affected path(s). Every jj command that prints a `git`-format diff gets the
same treatment, so the run-and-parse step is `diffFiles`, taking the argument
list that decides which diff we are looking at.

`atOperation` carries through to `--at-operation` here too, so a diff opened
from a historical log resolves its revision in that same past view rather
than failing when the change no longer exists.

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

The structural half is the same jj command run a second time with
[difftastic](difft.md) as its diff tool. jj writes both sides of every
changed file into two directories and runs `difft.ts` on them, which is the
only way to diff an interdiff's before side, a tree no id names once jj has
exited. The tool is configured on the command line rather than in the
user's jj config, so what diffy shows never depends on how the reader set up
their own `jj diff`.

A structural diff is something the reader may be shown, never something the
patch waits on. If the tool's answer cannot be read, every file says why and
keeps its patch. A file the tool has nothing for says why as well. That is a
binary, a file on only one side, a rename, whose two halves sit under
different paths, and the `JJ-COMMIT-DESCRIPTION` an interdiff adds, which jj
does not hand to external tools.

```ts
//| id: jj-module

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
```

`jj --git` names each side's path on its own line: `--- a/PATH` / `+++ b/PATH`
for text edits, `rename from` / `rename to` (or `copy ...`) for moves, and
`Binary files ... differ` for binaries. We read whichever of those is present
and only fall back to the `diff --git a/PATH b/PATH` header for the one case
that has none, a mode-only change. `/dev/null` on a side means that side
doesn't exist. A patch we can't pull a path from is a parser bug, not a jj
failure, so it throws a plain `Error` (a 500) rather than guessing.

The `index <old>..<new>` line names the blob each side's contents are stored
under, which is all a reader needs to fetch the [whole file](git.md#reading-a-files-contents)
a hunk was cut from. An id of all zeros stands for the side that does not
exist. A pure rename or a mode change has no `index` line and no contents
worth fetching, so both blobs stay null.

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
```

#### Test

`jjLog` and `jjOpLog` have a hard dependency on `jj`, so the tests exercise the
real CLI rather than mocking it. What matters is that the invocation is
right.

It asserts on structural invariants that hold regardless of this repo's
specific commit history: the root commit always exists, always sorts last in
`all()`, and always has the well-known all-zero commit ID / all-`z` change ID.

```ts
//| id: jj-module-test
//| file: src/backend/commit/jj.test.ts
import { describe, expect, test } from "bun:test";
import {
  COMMIT_MARKERS,
  JjError,
  jjCommits,
  jjDiff,
  jjDiffBetween,
  jjInterdiff,
  jjLog,
  jjOpLog,
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

  test("reads the log at a past operation", async () => {
    // arrange
    const operations = await jjOpLog();
    const earlier = operations.at(-1);

    // act
    const entries = await jjLog({
      revset: "all()",
      atOperation: earlier?.id,
    });

    // assert
    expect(entries.length).toBeGreaterThan(0);
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
```

The `jjDiff` parser is a pure function, so most of its cases are covered
without touching a repo, using the trimmed real `jj diff --git` output in the
fixtures below. Only the integration-level behaviour (default revision, error
wrapping) drives the real CLI.

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

  test("defaults to the working-copy revision", async () => {
    // arrange
    // act
    const [viaDefault, viaExplicit] = await Promise.all([
      jjDiff(),
      jjDiff({ revision: "@" }),
    ]);

    // assert
    expect(viaDefault).toEqual(viaExplicit);
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

The [tech plan](../../tech-plan.md)'s v1 feature is the interdiff: not what a
commit changes, but how one commit's change differs from another's.
`jj interdiff --from A --to B` answers that directly. It rebases A onto B's
parents before comparing, so a change that was only rebased reads as no
difference at all. That is the point of using it over `jj diff --from A --to B`,
which would also report everything that moved underneath the two commits.

The two sides need not be visible in the same view of the repo. A commit that
has since been amended away still sits in the store, and jj resolves it from a
full commit id even though no current view lists it. So the two ends of a
comparison can be picked out of two different operations and still meet in a
single `jj interdiff` call, with no `--at-operation` involved. Commit ids are
what buy that. A change id names whichever version of a commit the current view
holds, which is exactly what a before-and-after comparison must not do.

`jj interdiff` also emits a synthetic `JJ-COMMIT-DESCRIPTION` file whenever the
two descriptions differ. It reaches the UI as an ordinary file diff, which is
where we want it. How a commit message was reworded is part of how the change
evolved, and it is the first thing a reviewer of a re-pushed branch looks for.

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

`jjDiffBetween` is the other comparison, and the two are easy to mix up because
they take the same pair of revisions. This one compares trees. It answers
everything that differs between the two revisions, every commit that landed
between them included. `jjInterdiff` compares changes. It answers what the
second commit does that the first does not, with whatever both of them sit on
top of subtracted away.

Which one a caller wants follows from what the two revisions are to each other.
Two versions of one branch call for the interdiff, because the later version is
usually the earlier one rebased and the tree diff between them is mostly that
rebase. A branch against the commit it was cut from calls for the tree diff,
because there the tree difference is the work the branch adds and there is no
earlier version of it to subtract.

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

An interdiff needs two real commits, so these drive the CLI. The pair in the
first test is `root()+` and its child: two adjacent commits that every clone of
this repo has, and whose changes have nothing in common, so the interdiff
between them is never empty.

The cross-operation test is the one that matters. It takes a commit id out of
the repo's oldest operation and compares it against a commit in the current
view, passing no operation to `jjInterdiff` at all. In a repo whose history has
been rewritten, that old id names a commit no current view lists, which is
exactly the case the feature exists for. It passes either way, because
resolving a commit by full id does not depend on the commit still being
visible.

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

  test("wraps an unresolvable id in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(jjCommits(["no-such-commit-xyz"])).rejects.toBeInstanceOf(
      JjError,
    );
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

  test("wraps an unresolvable commit in JjError", async () => {
    // arrange
    const attempt = () => jjInterdiff({ from: "no-such-commit-xyz", to: "@" });

    // act
    // assert
    await expect(attempt()).rejects.toBeInstanceOf(JjError);
    await expect(attempt()).rejects.toThrow(/doesn't exist/);
  });
});
```

A tree diff from a commit to its child is that child's own diff, which is what
the first case below asserts, and it is the cheapest way to say what "tree
diff" means without a fixture. The second case runs both comparisons over the
same pair, because the whole risk with these two functions is a caller reaching
for the wrong one and getting a plausible answer.

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

  test("answers something other than the interdiff of the same pair", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const [tree, changes] = await Promise.all([
      jjDiffBetween({ from, to }),
      jjInterdiff({ from, to }),
    ]);

    // assert
    expect(tree.length).toBeGreaterThan(0);
    expect(tree).not.toEqual(changes);
  });

  test("wraps an unresolvable revision in JjError", async () => {
    // arrange
    const attempt = () =>
      jjDiffBetween({ from: "no-such-revision-xyz", to: "@" });

    // act
    // assert
    await expect(attempt()).rejects.toBeInstanceOf(JjError);
    await expect(attempt()).rejects.toThrow(/doesn't exist/);
  });
});
```
