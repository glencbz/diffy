# Local git object store

Commit content comes from the local git object store, asked through the `git`
CLI. The [GitHub backend](github.md) knows which commits a pull request has
had; this module is the other half, and knows what they say.

Everything it takes is an object id and everything it answers is what the
store holds, so nothing here knows about GitHub, pull requests or force
pushes. Metadata that arrives over an API is a claim about a remote at one
moment. The object store either has an object or does not, and a reader can
check. Only one of the two can go stale.

## Functionality

### Naming a commit

A `GitOid` is a full 40-character object id, and abbreviations are refused at
the type boundary rather than resolved, because fetching a single object by id
needs the whole id. The remote is being asked for a name it cannot look up in
a ref, so there is nothing to disambiguate a prefix against. A short id would
work for a local lookup and fail for a fetch.

`LocalOid` goes one step further. It is a `GitOid` carrying a witness that the
object store has the commit, and `gitMaterialize` is the only function that
mints one. A function that reads objects, `gitLog` today, takes `LocalOid` and
therefore cannot be reached without someone having established presence first.
The alternative, a plain `GitOid` everywhere and a runtime check inside every
reader, puts the same check in every new reader and forgets it in one of them.

`GitError` covers both ways a `git` call can let us down: a non-zero exit, and
a fetch that reports success without leaving the objects behind. A remote is
free to refuse an unreachable object, and older
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

`git cat-file -e <oid>^{commit}` is the presence check. The `^{commit}` suffix
peels the id and insists the result is a commit, so a tree or blob id that is
perfectly present answers no, which is the answer a commit reader wants. The
command is local and makes no network call.

Absence is an ordinary answer rather than a failure, so this returns `false`
instead of throwing. Every caller is about to decide whether to fetch, and
"not here yet" is the common case.

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
--prune` deletes it, taking the review's "before" side with it. The ref keeps
the object alive, so it has to say who is keeping it alive. Every pin therefore
arrives as a `GitPin`, an oid together with the path that will hold it, and
this module invents neither. Callers name their own pins, so nothing here knows
what a pull request is; `gitForget` takes a path prefix and drops everything
beneath it.

The naming that matters is the one the GitHub side chooses,
`pull/<number>/v<n>`, mirroring the `refs/pull/<number>/` layout GitHub
publishes. GitHub's own refs do not answer. `refs/pull/<number>/head` tracks
only the current head, so every state a force push replaced, which is the
entire reason this module exists, is advertised by no ref on the remote at
all. Those commits are still fetchable by
oid, which is what makes any of this work, but nothing names them.

Grouping under the pull request is what makes the pins collectable. A flat
namespace records that something wanted an object once and never when that
stops being true, so refs accumulate with no rule for clearing them. Grouped
under the pull request that pulled them in, the rule is ordinary: finish with a
pull request and the whole subtree can go.

That `v<n>` is diffy's own count of the force-push chain, not an identifier
GitHub issues, so it moves if GitHub collects the commits behind an old event
and that event drops out of the chain. The refs are a cache, not a record, so a
moved number re-points a ref and at worst orphans an object the next view
fetches again. What it buys is a namespace a person can read, which matters for
refs meant to be inspected and pruned by hand.

The refs sit under a namespace of our own, so they never appear as branches or
tags and jj never imports them as bookmarks.

A pin is written only for an object that had to be fetched. A commit already
reachable from a branch needs nothing holding it down, which is why viewing a
pull request whose base is an ordinary ancestor of `main` leaves no `base` ref
behind. If such an object later becomes unreachable and is collected, the next
view fetches and pins it like any other.

One fetch carries every missing oid, because a fetch is a round trip and a pull
request with six force pushes would otherwise pay for six. Oids already in the
store are filtered out first, so the all-present case, which is every repeat
view of the same pull request, costs a few `cat-file` calls and no network at
all.

`git fetch` can exit zero having declined an individual refspec, so the only
trustworthy report that the objects arrived is the object store itself, which
is what the presence re-check afterwards reads. Anything still missing is a
`GitError` naming it, and the error carries whatever the remote said.

The returned witnesses follow the order asked, duplicates included, so a caller
can destructure the result positionally against the list it passed.

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
  const missing = await absentPins(pins);

  if (missing.length > 0) {
    const refspecs = missing.map((pin) => `${pin.oid}:refs/diffy/${pin.at}`);
    const fetch = await $`git fetch --no-tags ${remote} ${refspecs}`
      .quiet()
      .nothrow();

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

Git keeps no durable identity for a commit, unlike jj's change id, so
`changeId` has to be derived rather than read off the object. The subject
line is what survives an amend, and lining up a pull request's old head
against its new one after an amend is the case this comparison exists to
show. A reword breaks the pairing instead, but that is the lesser failure.
A wrong pairing the reader can see and correct costs little, while a wrong
pairing that looks right and is not costs far more.

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

`git` is local, free and deterministic, so the tests drive the real CLI rather
than a mock, the same call the [jj tests](jj.md#test) make. What they assert on
is structural: this repo always has a `HEAD` with an ancestor, and 40 `f`s are
never an object.

A range needs more care than an ancestor does. `HEAD~1` is the tip's *first*
parent, so when the tip is a merge the range up to it is the whole branch that
was merged rather than one commit. A case that counts commits therefore passes
on a branch, whose tip is an ordinary commit, and fails on `main`, whose tip is
a merge. `soloCommit` names a commit that has exactly one parent, and that
parent, which is one commit apart whatever shape the history around it has.

The `gitMaterialize` case is about idempotence. Running it twice over an oid
that is already present must succeed both times and must not reach the network,
which is what makes repeat views of a pull request cheap. A fetch test would
need a remote and would prove less.

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
      changeId: "subject",
    });
  });

  test("carries the subject line as its changeId", () => {
    // arrange
    const raw = record([
      a,
      b,
      "Glen",
      "2026-09-10T11:08:01+00:00",
      "subject line\n\nbody\n",
    ]);

    // act
    // assert
    expect(parseLogRecord(raw).changeId).toBe("subject line");
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

`git merge-base <a> <b>` names the newest commit both histories hold, which is
where a branch left the base it was cut from. That commit, not the base branch
tip, is what "the work this branch introduces" is measured from. The tip has
moved on since the branch was cut, and a diff against it reports the base
branch's own later commits as the branch's work, reversed. On pull request #21
of this repository, a diff from today's `main` to the head reports fifty-one
files and a diff from the merge base reports none, which is the truth for a
pull request whose content is already in `main`.

Both ends are a `LocalOid` and so is the answer. A commit that two present
histories share is present itself, so the witness survives the call, and a
caller has to bring both ends down before it can ask where they meet.

Two commits can share no ancestor at all, which git reports as exit 1 with
nothing on either stream. That gets its own message, since a `GitError`
carrying git's silence tells the reader only that something went wrong.

```ts
//| id: git-module

/** The commit two heads share, which is where a branch and its base diverged. */
export async function gitMergeBase(
  a: LocalOid,
  b: LocalOid,
): Promise<LocalOid> {
  const result = await $`git merge-base ${a} ${b}`.quiet().nothrow();
  const shared = result.text().trim();

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

The pair worth pinning is one whose merge base is neither end. Two commits
taken along one line of history have the older one as their merge base, so
they pass just as well against an implementation that answers `a` and never
asks git. A merge is where this repository keeps a diverged pair, so
`divergedPair` reads the parents of one, skipping the merges whose parents are
already in each other's history.

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

A diff shows a file only in the hunks that changed, and some of what a reader
wants needs the rest of it: syntax colours for a line depend on what came
before it, and context around a hunk is lines the patch left out. The `index`
line of every [`git`-format patch](jj.md#reading-a-commits-diff) names the
blob each side is stored under, and in a colocated repo those blobs are in
git's object store, whether jj wrote them or a
[pull request fetch](#fetching-a-commit-nothing-points-at) brought them.

`BlobId` takes an id as short as git itself will resolve, because the `index`
line abbreviates. An id that names nothing, or names more than one object, is
an ordinary answer for a reader holding an id out of someone else's patch, so
`gitBlob` answers null rather than throwing.

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
