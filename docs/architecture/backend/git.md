# Local git object store

The [GitHub backend](github.md) knows which commits a pull request has had. It
does not know what any of them say. This module is the other half: the local
git object store, asked directly through the `git` CLI, which is where commit
content comes from.

It knows nothing about GitHub, pull requests or forces pushes. Everything it
takes is an object id and everything it answers is what the store holds. That
split is deliberate. Commit metadata that arrives over an API is a claim about
a remote at one moment, while the object store either has an object or does
not, and a reader can check. Keeping the two apart means only one of them can
be stale.

## Functionality

### Naming a commit

A `GitOid` is a full 40-character object id, and abbreviations are refused at
the type boundary rather than resolved. Fetching a single object by id needs
the whole id: the remote is being asked for a name it cannot look up in a ref,
so there is nothing to disambiguate a prefix against. Accepting short ids here
would mean a value that works for a local lookup and fails for a fetch, which
is the sort of distinction a type is for.

`LocalOid` goes one step further. It is a `GitOid` carrying a witness that the
object store has the commit, and `gitMaterialize` is the only function that
mints one. A function that reads objects, `gitLog` today, takes `LocalOid` and
therefore cannot be reached without someone having established presence first.
The alternative, a plain `GitOid` everywhere and a runtime check inside every
reader, puts the same check in every new reader and forgets it in one of them.

`GitError` covers both ways a `git` call can let us down: a non-zero exit, and
a fetch that reports success without leaving the objects behind. The second is
not hypothetical. A remote is free to refuse an unreachable object, and older
`git` versions say so only in the exit status of the ref update.

```ts
//| id: git-module
//| file: src/backend/commit/git.ts
import { $ } from "bun";
import * as z from "zod";

/** A full 40-hex git object id. Abbreviations are refused: fetch-by-oid needs all 40. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

declare const presentLocally: unique symbol;
/** A GitOid proven to be in this repo's object store. Only `gitMaterialize` mints one. */
export type LocalOid = GitOid & { readonly [presentLocally]: true };

/** `git` exited non-zero, or a fetch completed without delivering the objects. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}

/** One commit as the local object store has it. */
export interface GitCommit {
  commitId: GitOid;
  parents: GitOid[];
  /** Full commit message, subject and body, matching JjLogEntry.description. */
  description: string;
  author: string;
  /** ISO 8601 author date. */
  authoredAt: string;
}
```

### Asking whether a commit is here

`git cat-file -e <oid>^{commit}` is the presence check. The `^{commit}` suffix
peels the id and insists the result is a commit, so a tree or blob id that is
perfectly present answers no, which is the answer a commit reader wants. The
command is local and makes no network call.

Absence is an ordinary answer rather than a failure, so this returns `false`
instead of throwing. Every caller is about to decide whether to fetch, and a
thrown exception would make "not here yet" the exceptional path when it is the
common one.

```ts
//| id: git-module

/** Whether the object store already holds `oid` as a commit. Never hits the network. */
export async function gitHasCommit(oid: GitOid): Promise<boolean> {
  const spec = `${oid}^{commit}`;
  const result = await $`git cat-file -e ${spec}`.quiet().nothrow();
  return result.exitCode === 0;
}
```

### Fetching a commit nothing points at

A force-pushed commit is unreachable from every branch on the remote, so no
ordinary fetch brings it down. Naming the object id in the refspec does:
`git fetch --no-tags origin <oid>:<ref>` hands over that commit and its whole
ancestry, which is what makes the history of a rewritten pull request readable
at all.

The destination ref is the load-bearing half of that command. A fetched object
that nothing points at is unreachable locally too, and the next `git gc
--prune` deletes it, taking the review's "before" side with it. Writing
`refs/diffy/commits/<oid>` pins it. The refs live under a namespace of our own
so they never appear as branches or tags, and they are content-addressed by the
oid they protect, which makes the fetch idempotent: asking again for a pinned
oid is a no-op the remote answers immediately.

One fetch carries every missing oid, because a fetch is a round trip and a pull
request with six force pushes would otherwise pay for six. Oids already in the
store are filtered out first, so the all-present case, which is every repeat
view of the same pull request, costs a few `cat-file` calls and no network at
all.

The presence re-check afterwards is not belt and braces. `git fetch` can exit
zero having declined an individual refspec, so the only trustworthy report that
the objects arrived is the object store itself. Anything still missing is a
`GitError` naming it, and the error carries whatever the remote said.

The returned witnesses follow the order asked, duplicates included, so a caller
can destructure the result positionally against the list it passed.

```ts
//| id: git-module

/** Oids the store does not hold, in the order given. */
async function absentFrom(oids: GitOid[]): Promise<GitOid[]> {
  const present = await Promise.all(oids.map(gitHasCommit));
  return oids.filter((_, index) => present[index] === false);
}

/**
 * Ensure every oid is in the local object store, fetching what is missing, and
 * return each one as a `LocalOid` in the order asked.
 */
export async function gitMaterialize(
  oids: GitOid[],
  remote = "origin",
): Promise<LocalOid[]> {
  const missing = await absentFrom([...new Set(oids)]);

  if (missing.length > 0) {
    const refspecs = missing.map((oid) => `${oid}:refs/diffy/commits/${oid}`);
    const fetch = await $`git fetch --no-tags ${remote} ${refspecs}`
      .quiet()
      .nothrow();

    const stillMissing = await absentFrom(missing);
    if (stillMissing.length > 0) {
      const said = fetch.stderr.toString().trim();
      throw new GitError(
        `${remote} did not deliver ${stillMissing.join(", ")}${said === "" ? "" : `: ${said}`}`,
        fetch.exitCode,
      );
    }
  }

  return oids as LocalOid[];
}
```

### Reading commits out of the store

`git log` has no `json(self)` the way [jj](jj.md) does, so the output format is
ours to choose and the choice is the parse contract. Commit messages contain
newlines, author names contain almost anything, and a format that separates
fields with a character a field can hold is a format that eventually
mis-parses.

The format is `%H%x1f%P%x1f%an%x1f%aI%x1f%B` with `-z`. Records are terminated
by NUL, which cannot occur in any git field, and fields are separated by
`\x1f`, the ASCII unit separator, which no sane commit message contains. The
message body is the last field, so even if it did contain a `\x1f` the fields
before it are already parsed. Nothing is escaped and nothing needs to be.

A record that does not split into exactly five fields means the format string
and the parser disagree, which is a bug here and not a bad request, so it
throws a plain `Error` and becomes a 500. `parseLogRecord` is exported for
that reason, mirroring [`parseFileDiff`](jj.md#reading-a-commits-diff): the
interesting failure modes are fixtures, not repos.

Ordering matches `jj log`, newest first, because both feed the same list in the
UI. `from` is an exclusive lower bound, so the range is `git log <from>..<to>`,
the commits `to` has and `from` does not, which is exactly the contents of a
pull request measured against its base.

```ts
//| id: git-module

export interface GitLogRange {
  /** Exclusive lower bound: `git log <from>..<to>`. Omit for all ancestors of `to`. */
  from?: LocalOid | undefined;
  to: LocalOid;
  limit?: number | undefined;
}

const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%B";

/** Read commits from the local store, newest first, matching `jj log` order. */
export async function gitLog(range: GitLogRange): Promise<GitCommit[]> {
  const args = ["log", "--no-color", "-z", `--format=${LOG_FORMAT}`];
  if (range.limit !== undefined) args.push("-n", String(range.limit));
  args.push(range.from === undefined ? range.to : `${range.from}..${range.to}`);

  const result = await $`git ${args}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const said = result.stderr.toString().trim();
    throw new GitError(
      said || `git log exited ${result.exitCode}`,
      result.exitCode,
    );
  }

  return result
    .text()
    .split("\0")
    .filter((record) => record.length > 0)
    .map(parseLogRecord);
}

/** Exported for unit tests: turn one NUL-terminated log record into a commit. */
export function parseLogRecord(record: string): GitCommit {
  const fields = record.split("\x1f");
  if (fields.length < 5) {
    throw new Error(
      `gitLog: expected 5 fields, got ${fields.length} in: ${record}`,
    );
  }
  const [commitId = "", parents = "", author = "", authoredAt = ""] = fields;

  return {
    commitId: GitOid.parse(commitId),
    parents:
      parents === "" ? [] : parents.split(" ").map((p) => GitOid.parse(p)),
    // The body is last, so a separator inside a commit message rejoins here
    // rather than failing the whole record.
    description: fields.slice(4).join("\x1f"),
    author,
    authoredAt,
  };
}
```

#### Test

`git` is local, free and deterministic, so the tests drive the real CLI rather
than a mock, the same call the [jj tests](jj.md#test) make. What they assert on
is structural: this repo always has a `HEAD` with an ancestor, and 40 `f`s are
never an object.

The `gitMaterialize` case is about idempotence, not fetching. Running it twice
over an oid that is already present must succeed both times and must not reach
the network, which is the property that makes repeat views of a pull request
cheap. A fetch test would need a remote and would prove less.

```ts
//| id: git-module-test
//| file: src/backend/commit/git.test.ts
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  GitOid,
  gitHasCommit,
  gitLog,
  gitMaterialize,
  parseLogRecord,
} from "./git";

/** The oid `revision` names, as this repo's git store has it. */
async function oidOf(revision: string): Promise<GitOid> {
  return GitOid.parse(
    (await $`git rev-parse ${revision}`.quiet().text()).trim(),
  );
}

const MISSING = GitOid.parse("f".repeat(40));

describe("gitHasCommit", () => {
  test("finds a commit that is here", async () => {
    // arrange
    const head = await oidOf("HEAD");

    // act
    // assert
    expect(await gitHasCommit(head)).toBe(true);
  });

  test("answers false for an oid nothing has", async () => {
    // arrange
    // act
    // assert
    expect(await gitHasCommit(MISSING)).toBe(false);
  });
});

describe("gitMaterialize", () => {
  test("resolves an already-present oid, twice, without fetching", async () => {
    // arrange
    const head = await oidOf("HEAD");

    // act
    const first = await gitMaterialize([head]);
    const second = await gitMaterialize([head]);

    // assert
    expect(first as GitOid[]).toEqual([head]);
    expect(second).toEqual(first);
  });

  test("keeps the order it was asked in", async () => {
    // arrange
    const [head, parent] = [await oidOf("HEAD"), await oidOf("HEAD~1")];

    // act
    const oids = await gitMaterialize([parent, head]);

    // assert
    expect(oids as GitOid[]).toEqual([parent, head]);
  });
});

describe("gitLog", () => {
  test("reads the commits the tip has and the base does not", async () => {
    // arrange
    const [base, head] = await gitMaterialize([
      await oidOf("HEAD~1"),
      await oidOf("HEAD"),
    ]);
    if (base === undefined || head === undefined) throw new Error("no oids");

    // act
    const commits = await gitLog({ from: base, to: head });

    // assert
    expect(commits).toHaveLength(1);
    expect(commits[0]?.commitId).toBe(head);
    expect(commits[0]?.parents).toContain(base);
    expect(commits[0]?.description.length).toBeGreaterThan(0);
    expect(commits[0]?.author.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(commits[0]?.authoredAt ?? ""))).toBe(false);
  });

  test("puts the tip first and honours the limit", async () => {
    // arrange
    const [head] = await gitMaterialize([await oidOf("HEAD")]);
    if (head === undefined) throw new Error("no oid");

    // act
    const commits = await gitLog({ to: head, limit: 3 });

    // assert
    expect(commits).toHaveLength(3);
    expect(commits[0]?.commitId).toBe(head);
    expect(commits[1]?.commitId).not.toBe(head);
  });
});
```

`parseLogRecord` carries the delimiter contract, so its cases are the shapes
that break a naive line-oriented parser: a body with blank lines and its own
newlines, a merge with two parents, and the root commit with none.

```ts
//| id: git-module-test

describe("parseLogRecord", () => {
  const a = GitOid.parse("1".repeat(40));
  const b = GitOid.parse("2".repeat(40));
  const c = GitOid.parse("3".repeat(40));

  function record(fields: string[]): string {
    return fields.join("\x1f");
  }

  test("reads a single-parent commit", () => {
    // arrange
    const raw = record([
      a,
      b,
      "Glen",
      "2026-09-10T11:08:01+00:00",
      "subject\n",
    ]);

    // act
    // assert
    expect(parseLogRecord(raw)).toEqual({
      commitId: a,
      parents: [b],
      description: "subject\n",
      author: "Glen",
      authoredAt: "2026-09-10T11:08:01+00:00",
    });
  });

  test("keeps a multi-line body whole", () => {
    // arrange
    const body = "subject line\n\nbody line one\nbody line two\n";
    const raw = record([a, b, "Glen", "2026-09-10T11:08:01+00:00", body]);

    // act
    // assert
    expect(parseLogRecord(raw).description).toBe(body);
  });

  test("reads both parents of a merge", () => {
    // arrange
    const raw = record([
      a,
      `${b} ${c}`,
      "Glen",
      "2026-09-10T11:08:01+00:00",
      "merge\n",
    ]);

    // act
    // assert
    expect(parseLogRecord(raw).parents).toEqual([b, c]);
  });

  test("reads a root commit as parentless", () => {
    // arrange
    const raw = record([a, "", "Glen", "2026-09-10T11:08:01+00:00", "first\n"]);

    // act
    // assert
    expect(parseLogRecord(raw).parents).toEqual([]);
  });

  test("keeps a separator that appears inside the message body", () => {
    // arrange
    const raw = record([a, b, "Glen", "2026-09-10T11:08:01+00:00", "a\x1fb\n"]);

    // act
    // assert
    expect(parseLogRecord(raw).description).toBe("a\x1fb\n");
  });

  test("treats too few fields as a bug, not a bad request", () => {
    // arrange
    const raw = record([a, b, "Glen"]);

    // act
    // assert
    expect(() => parseLogRecord(raw)).toThrow(/expected 5 fields/);
  });
});
```
