# jj

Diffy shells out to the [`jj`](https://jj-vcs.dev/) CLI rather than linking to the 
library. Per the [tech plan](../tech-plan.md) that's the more stable surface.

## Functionality

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
//| file: src/jj.ts
import { $ } from "bun";
import * as z from "zod";

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

  const output = await $`jj ${args}`.quiet().text();

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
//| file: src/jj.test.ts
import { describe, expect, test } from "bun:test";
import { jjLog } from "./jj";

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
});
```
