# Local git object store

Commit content comes from the local git object store via the `git` CLI. The
[GitHub backend](github.md) knows which commits a pull request has had; this
module knows what they say. It takes object ids and nothing here knows about
GitHub: API metadata can go stale, an object in the store cannot.

`LocalOid` is a `GitOid` witnessed present, minted only by `gitMaterialize`,
so readers such as `gitLog` cannot be reached without the presence check. A
runtime check in every reader would be forgotten in one of them.

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

/**
 * A path under `refs/diffy/`. Names where a pin lives and what `gitForget`
 * collects, so it is the thing that decides when an object may go.
 */
export const RefPath = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "expected a ref path such as pull/42/v3")
  .brand("RefPath");
export type RefPath = z.infer<typeof RefPath>;

/** An object to obtain, and the ref that will keep it alive once obtained. */
export interface GitPin {
  at: RefPath;
  oid: GitOid;
}

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
  /** What lines this commit up against another across a rewrite. Git records
   *  nothing durable here, so it is derived from the subject line, and it is
   *  null when there is no subject. */
  changeId: string | null;
}
```

### Asking whether a commit is here

```ts
//| id: git-module

/** Whether the object store already holds `oid` as a commit. Never hits the network. */
export async function gitHasCommit(oid: GitOid): Promise<boolean> {
  // ^{commit} makes a present tree or blob id answer no.
  const spec = `${oid}^{commit}`;
  const result = await $`git cat-file -e ${spec}`.quiet().nothrow();
  return result.exitCode === 0;
}
```

### Fetching a commit nothing points at

A force-pushed commit is unreachable from every remote branch, and GitHub's
`refs/pull/<n>/head` names only the current head, but the commit is still
fetchable by oid: `git fetch --no-tags origin <oid>:<ref>`. The destination
ref keeps the fetched object from the next `git gc --prune`, so every pin is a
`GitPin`, an oid plus the path holding it. Callers choose the path; the GitHub
side uses `pull/<number>/v<n>` so a finished pull request's pins go together
under one `gitForget`. Refs live under `refs/diffy/`, so jj never imports them
as bookmarks. They are a cache: an object already reachable from a branch
gets no pin, and a lost one is fetched again on the next view.

```ts
//| id: git-module

/** Pins whose object the store does not hold, one per distinct oid. */
async function absentPins(pins: GitPin[]): Promise<GitPin[]> {
  const unique = [...new Map(pins.map((pin) => [pin.oid, pin])).values()];
  const present = await Promise.all(unique.map((pin) => gitHasCommit(pin.oid)));
  return unique.filter((_, index) => present[index] === false);
}

/**
 * Ensure every oid is in the local object store, fetching what is missing, and
 * return each one as a `LocalOid` in the order asked.
 */
export async function gitMaterialize(
  pins: GitPin[],
  remote = "origin",
): Promise<LocalOid[]> {
  // One fetch for every missing oid; a repeat view fetches nothing.
  const missing = await absentPins(pins);

  if (missing.length > 0) {
    const refspecs = missing.map((pin) => `${pin.oid}:refs/diffy/${pin.at}`);
    const fetch = await $`git fetch --no-tags ${remote} ${refspecs}`
      .quiet()
      .nothrow();

    // git fetch can exit zero having declined a refspec, so the store
    // itself is the only trustworthy report.
    const stillMissing = await absentPins(missing);
    if (stillMissing.length > 0) {
      const said = fetch.stderr.toString().trim();
      const lost = stillMissing.map((pin) => pin.oid).join(", ");
      throw new GitError(
        `${remote} did not deliver ${lost}${said === "" ? "" : `: ${said}`}`,
        fetch.exitCode,
      );
    }
  }

  return pins.map((pin) => pin.oid) as LocalOid[];
}

/** Drop the pins under a path, so `git gc` can reclaim what nothing else holds. */
export async function gitForget(prefix: RefPath): Promise<number> {
  const args = ["for-each-ref", "--format=%(refname)", `refs/diffy/${prefix}/`];
  const listed = await $`git ${args}`.quiet().nothrow();
  if (listed.exitCode !== 0) {
    throw new GitError(
      listed.stderr.toString().trim() ||
        `git for-each-ref exited ${listed.exitCode}`,
      listed.exitCode,
    );
  }

  const refs = listed
    .text()
    .split("\n")
    .filter((ref) => ref.length > 0);
  if (refs.length === 0) return 0;

  const script = Buffer.from(refs.map((ref) => `delete ${ref}\n`).join(""));
  const dropped = await $`git update-ref --stdin < ${script}`.quiet().nothrow();
  if (dropped.exitCode !== 0) {
    throw new GitError(
      dropped.stderr.toString().trim() ||
        `git update-ref exited ${dropped.exitCode}`,
      dropped.exitCode,
    );
  }

  return refs.length;
}
```

### Reading commits out of the store

`git log` has no `json(self)` the way [jj](jj.md) does, so the format is
`%H%x1f%P%x1f%an%x1f%aI%x1f%B` with `-z`: NUL ends a record and cannot occur
in a field, `\x1f` separates fields, and the message comes last so a stray
`\x1f` in it cannot shift the others.

Git has no change id, so `changeId` is the subject line, which survives an
amend, the case a pull request comparison exists to show. A reword breaks the
pairing, visibly, and the reader can correct it.

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

/** The subject line, the closest thing to a stable identity git offers.
 *  Null when the commit has no subject to derive one from. */
export function subjectIdentity(description: string): string | null {
  const subject = description.split("\n")[0]?.trim() ?? "";
  return subject === "" ? null : subject;
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
  // The body is last, so a separator inside a commit message rejoins here
  // rather than failing the whole record.
  const description = fields.slice(4).join("\x1f");

  return {
    commitId: GitOid.parse(commitId),
    parents:
      parents === "" ? [] : parents.split(" ").map((p) => GitOid.parse(p)),
    description,
    author,
    authoredAt,
    changeId: subjectIdentity(description),
  };
}
```

#### Test

The tests drive the real CLI against this repository. `soloCommit` names a
commit with exactly one parent, since `HEAD~1..HEAD` spans a whole merged
branch when the tip is a merge.

```ts
//| id: git-module-test
//| file: src/backend/commit/git.test.ts
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  BlobId,
  GitOid,
  gitBlob,
  gitForget,
  gitHasCommit,
  gitLog,
  gitMaterialize,
  gitMergeBase,
  parseLogRecord,
  RefPath,
  subjectIdentity,
} from "./git";

/** The oid `revision` names, as this repo's git store has it. */
async function oidOf(revision: string): Promise<GitOid> {
  return GitOid.parse(
    (await $`git rev-parse ${revision}`.quiet().text()).trim(),
  );
}

/** The newest commit with a single parent, and that parent. Exactly one commit
 *  apart, which `HEAD~1` and `HEAD` are not when the tip is a merge. */
async function soloCommit(): Promise<[base: GitOid, head: GitOid]> {
  const head = await oidOf(
    (
      await $`git rev-list --no-merges --max-count=1 HEAD`.quiet().text()
    ).trim(),
  );
  return [await oidOf(`${head}~1`), head];
}

const MISSING = GitOid.parse("f".repeat(40));
const SCOPE = RefPath.parse("pull/0");

/** Pin an oid somewhere harmless for tests that only care about presence. */
const pin = (oid: GitOid) => ({ at: RefPath.parse(`${SCOPE}/v1`), oid });

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

describe("gitForget", () => {
  test("drops only its own scope's pins, and reports how many", async () => {
    // arrange
    const head = await oidOf("HEAD");
    const mine = RefPath.parse("pull/999999");
    const other = RefPath.parse("pull/999998");
    await $`git update-ref ${`refs/diffy/${mine}/${head}`} ${head}`.quiet();
    await $`git update-ref ${`refs/diffy/${other}/${head}`} ${head}`.quiet();

    // act
    const dropped = await gitForget(mine);

    // assert
    expect(dropped).toBe(1);
    expect(await gitHasCommit(head)).toBe(true);
    const listing = ["for-each-ref", "--format=%(refname)", "refs/diffy/"];
    const left = await $`git ${listing}`.quiet().text();
    expect(left).not.toContain(`refs/diffy/${mine}/`);
    expect(left).toContain(`refs/diffy/${other}/`);

    // cleanup
    await gitForget(other);
  });

  test("reports nothing to drop for an untouched scope", async () => {
    // arrange
    // act
    // assert
    expect(await gitForget(RefPath.parse("pull/999997"))).toBe(0);
  });
});

describe("gitMaterialize", () => {
  test("resolves an already-present oid, twice, without fetching", async () => {
    // arrange
    const head = await oidOf("HEAD");

    // act
    const first = await gitMaterialize([pin(head)]);
    const second = await gitMaterialize([pin(head)]);

    // assert
    expect(first as GitOid[]).toEqual([head]);
    expect(second).toEqual(first);
  });

  test("keeps the order it was asked in", async () => {
    // arrange
    const [head, parent] = [await oidOf("HEAD"), await oidOf("HEAD~1")];

    // act
    const oids = await gitMaterialize([pin(parent), pin(head)]);

    // assert
    expect(oids as GitOid[]).toEqual([parent, head]);
  });
});

describe("gitLog", () => {
  test("reads the commits the tip has and the base does not", async () => {
    // arrange
    const [soloBase, soloHead] = await soloCommit();
    const [base, head] = await gitMaterialize([pin(soloBase), pin(soloHead)]);
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
    const [head] = await gitMaterialize([pin(await oidOf("HEAD"))]);
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
      changeId: "subject",
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

describe("subjectIdentity", () => {
  test("takes the subject line as the identity", () => {
    // arrange
    const description = "subject line\n\nbody line one\nbody line two\n";

    // act
    // assert
    expect(subjectIdentity(description)).toBe("subject line");
  });

  test("trims surrounding whitespace", () => {
    // arrange
    const description = "  subject line with padding  \n";

    // act
    // assert
    expect(subjectIdentity(description)).toBe("subject line with padding");
  });

  test("has no identity for an empty message", () => {
    // arrange
    // act
    // assert
    expect(subjectIdentity("")).toBe(null);
  });

  test("has no identity for a message that is only blank lines", () => {
    // arrange
    // act
    // assert
    expect(subjectIdentity("\n\n")).toBe(null);
  });
});
```

### Where a branch and its base diverged

A pull request's work is measured from the merge base, not the base branch's
tip: the tip has moved on, and a diff against it reports the base's own later
commits as the branch's work, reversed.

```ts
//| id: git-module

/** The commit two heads share, which is where a branch and its base diverged. */
export async function gitMergeBase(
  a: LocalOid,
  b: LocalOid,
): Promise<LocalOid> {
  const result = await $`git merge-base ${a} ${b}`.quiet().nothrow();
  const shared = result.text().trim();

  // No common ancestor is exit 1 with nothing on either stream.
  if (result.exitCode !== 0 || shared === "") {
    const said = result.stderr.toString().trim();
    throw new GitError(
      said || `${a} and ${b} share no ancestor`,
      result.exitCode,
    );
  }

  return GitOid.parse(shared) as LocalOid;
}
```

#### Test

`divergedPair` reads a merge's parents, since a pair along one line of history
would pass an implementation that just answered `a`.

```ts
//| id: git-module-test

/** Whether `ancestor` is in `descendant`'s history. */
async function isAncestor(
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
  return (await $`git ${args}`.quiet().nothrow()).exitCode === 0;
}

/** Two commits neither of which is the other's ancestor, read off the parents
 *  of a merge. Any pair along one line of history is ancestor-related. */
async function divergedPair(): Promise<[GitOid, GitOid]> {
  const merges = await $`git log --merges --format=%P`.quiet().text();
  for (const line of merges.split("\n")) {
    const [left, right] = line.split(" ");
    if (left === undefined || right === undefined) continue;
    if (await isAncestor(left, right)) continue;
    if (await isAncestor(right, left)) continue;
    return [await oidOf(left), await oidOf(right)];
  }
  throw new Error("this repo has no merge of two diverged histories");
}

describe("gitMergeBase", () => {
  test("finds the commit two diverged histories share", async () => {
    // arrange
    const [left, right] = await gitMaterialize((await divergedPair()).map(pin));
    if (left === undefined || right === undefined) throw new Error("no oids");

    // act
    const shared = await gitMergeBase(left, right);

    // assert
    expect(shared).not.toBe(left);
    expect(shared).not.toBe(right);
    expect(await isAncestor(shared, left)).toBe(true);
    expect(await isAncestor(shared, right)).toBe(true);
  });

  test("answers the older commit when one is the other's ancestor", async () => {
    // arrange
    const [base, head] = await gitMaterialize((await soloCommit()).map(pin));
    if (base === undefined || head === undefined) throw new Error("no oids");

    // act
    // assert
    expect(await gitMergeBase(base, head)).toBe(base);
  });
});
```

### Reading a file's contents

Highlighting and expanded context need whole files. The `index` line of every
[`git`-format patch](jj.md#reading-a-commits-diff) names each side's blob, and
in a colocated repo the blob is in git's store. `BlobId` accepts the
abbreviated ids that line prints; an unknown or ambiguous id answers null.

```ts
//| id: git-module

/** A git blob id, whole or abbreviated the way a patch's `index` line prints it. */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{4,64}$/, "expected a hex git blob id")
  .brand("BlobId");
export type BlobId = z.infer<typeof BlobId>;

/** A blob's contents as text, or null when the store has no one blob by that id. */
export async function gitBlob(id: BlobId): Promise<string | null> {
  const result = await $`git cat-file blob ${id}`.quiet().nothrow();
  return result.exitCode === 0 ? result.text() : null;
}
```

#### Test

```ts
//| id: git-module-test

describe("gitBlob", () => {
  test("reads a file back by the blob id a tree holds it under", async () => {
    // arrange
    const id = BlobId.parse(
      (await $`git rev-parse HEAD:package.json`.quiet().text()).trim(),
    );

    // act
    const text = await gitBlob(id);

    // assert
    expect(text).toBe(await $`git show HEAD:package.json`.quiet().text());
  });

  test("answers null for an id that names nothing", async () => {
    // arrange
    // act
    // assert
    expect(await gitBlob(BlobId.parse("f".repeat(40)))).toBeNull();
  });
});
```
