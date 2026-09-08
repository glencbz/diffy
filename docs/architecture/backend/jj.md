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
import { JjError, jjLog } from "./jj";

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
