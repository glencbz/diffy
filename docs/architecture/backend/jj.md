# jj commit backend

We'll use jj as our primary commit backend. This shells out to the
[`jj`](https://jj-vcs.dev/) CLI rather than linking to the library. Per the
[tech plan](../tech-plan.md) that's the more stable surface.

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
object per line (JSONL) and let `JSON.parse` do the work:

```sh
jj log --no-graph -T 'json(self) ++ "\n"'
```

`--no-graph` drops the ASCII-art graph column so each line of stdout is
exactly one commit's output.

```ts
//| id: jj-module

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
```

### Reading a commit's diff

`jj diff --git -r <revision>` prints a standard `git`-format unified diff of a
revision against its parent. That is the "show a commit's diff" operation the
[tech plan](../tech-plan.md) calls for, and `--color=never` keeps the output
free of ANSI escapes.

We don't parse hunks: the raw `--git` patch is the payload a review UI renders.
We only split the combined output into one entry per file and read the
metadata the UI needs off each file's header, namely the change kind and the
affected path(s).

```ts
//| id: jj-module

/** How one file changed between a revision and its parent. */
export type JjFileDiff = (
  | { status: "added" | "deleted" | "modified"; path: string }
  | { status: "renamed" | "copied"; oldPath: string; newPath: string }
) & {
  /** True when jj emitted "Binary files ... differ" in place of a text hunk. */
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
```

`jj --git` names each side's path on its own line: `--- a/PATH` / `+++ b/PATH`
for text edits, `rename from` / `rename to` (or `copy ...`) for moves, and
`Binary files ... differ` for binaries. We read whichever of those is present
and only fall back to the `diff --git a/PATH b/PATH` header for the one case
that has none, a mode-only change. `/dev/null` on a side means that side
doesn't exist. A patch we can't pull a path from is a parser bug, not a jj
failure, so it throws a plain `Error` (a 500) rather than guessing.

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
      oldPath = stripPrefix(line.slice("--- ".length));
    } else if (line.startsWith("+++ ")) {
      newPath = stripPrefix(line.slice("+++ ".length));
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
```

#### Test

`jjLog` is has a hard dependency on `jj`, so the test exercises the real CLI
(rather than mocking it), since what we really care about is that we got the jj
invocation right.

It asserts on structural invariants that hold regardless of this repo's
specific commit history: the root commit always exists, always sorts last in
`all()`, and always has the well-known all-zero commit ID / all-`z` change ID.

```ts
//| id: jj-module-test
//| file: src/backend/commit/jj.test.ts
import { describe, expect, test } from "bun:test";
import { JjError, jjDiff, jjLog, parseFileDiff } from "./jj";

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
    }

    const root = entries.at(-1);
    expect(root?.commitId).toBe("0".repeat(40));
    expect(root?.changeId).toBe("z".repeat(32));
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
