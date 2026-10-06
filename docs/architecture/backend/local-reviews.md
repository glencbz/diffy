# Local reviews

A local review is a series of local commits someone registered as ready for
review, with every version registered since; the
[direction](../../direction.md#a-local-review-is-registered) says why it is
registered rather than read off the bookmarks. This module turns a
registration into a version the [review document](review-store.md) keeps, and
reads what a version names for the series review screen.

## Registering a version

`registrationDefaults` fills in what the caller left out. A name the review
document already has defaults its revset to that review's last version, so a
series that was split or renamed stays one review. A new name defaults to
the bookmark of that name. Only a registration with no name falls back to the
bookmark below the working copy, because the working copy is the server's,
and a caller in another workspace has a different one. A default the repository
cannot supply is null, and registering without it fails saying what to give,
which is how an agent that makes no bookmarks learns to pass
`trunk()..<change id>`.

The revset is evaluated at the registration's operation, and the version keeps
the commit ids it named rather than the revset. Evaluating the revset again
later would read today's repository, and jj reads a hidden commit by its id,
so a version stays readable after its commits are rewritten.

## Reading a version

`localCommits` answers in a pull request's commit shape, so the series screen
draws both the same way; the jj change id lines commits up across versions
with no subject-line guess. `localSize` asks `jj diff` for the whole set
rather than diffing from the oldest commit's parent, because a series built on
a merge has no single parent.

```ts
//| id: backend-local-reviews
//| file: src/backend/review/local.ts
import {
  type LocalVersion,
  localReview,
  type ReviewDocument,
} from "../../frontend/model/review";
import { type GitCommit, GitOid } from "../commit/git";
import {
  type JjFileDiff,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "../commit/jj";

/** What a caller asked to register. Anything left out takes its default. */
export interface Registration {
  name?: string;
  revset?: string;
  operation?: string;
}

/** A registration the caller cannot make without saying more. */
export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

async function bookmarkBelowWorkingCopy(
  operation: string,
): Promise<string | null> {
  const [entry] = await jjLog({
    revset: "heads(::@ & bookmarks())",
    atOperation: operation,
    limit: 1,
  });
  const bookmark = entry?.refs.find(
    (ref) => ref.kind === "bookmark" && !ref.name.includes("@"),
  );
  return bookmark?.name ?? null;
}

/** The registration `asked` stands for, with each default filled in, or
 *  null where the repository cannot supply one. */
export async function registrationDefaults(
  document: ReviewDocument,
  asked: Registration,
): Promise<{ name: string | null; revset: string | null; operation: string }> {
  const [current] = await jjOpLog({ limit: 1 });
  if (current === undefined) throw new Error("jj reported no operations");
  const operation = asked.operation ?? current.id;
  const bookmark = await bookmarkBelowWorkingCopy(operation);
  const name = asked.name ?? bookmark;
  const last =
    name === null ? undefined : localReview(document, name)?.versions.at(-1);
  const revset =
    asked.revset ??
    last?.revset ??
    // Quoted, since a bookmark name can hold what a bare symbol cannot.
    (name === null ? null : `trunk()..${JSON.stringify(name)}`);
  return { name, revset, operation };
}

/** The version `asked` registers, under the name it goes by. */
export async function resolveRegistration(
  document: ReviewDocument,
  asked: Registration,
  at: string,
): Promise<{ name: string; version: LocalVersion }> {
  const { name, revset, operation } = await registrationDefaults(
    document,
    asked,
  );
  if (name === null || revset === null) {
    throw new RegistrationError(
      "no bookmark sits at or below the working copy, so give the review a name and a revset",
    );
  }
  const commits = await jjLog({ revset, atOperation: operation });
  if (commits.length === 0) {
    throw new RegistrationError(`${revset} names no commits`);
  }
  return {
    name,
    version: {
      operation,
      revset,
      commits: commits.map((commit) => commit.commitId).reverse(),
      registeredAt: at,
    },
  };
}

/** The commits `ids` name, in that order, in a pull request's shape. */
export async function localCommits(ids: string[]): Promise<GitCommit[]> {
  const found = await jjCommits(ids);
  return ids.flatMap((id) => {
    const entry = found.get(id);
    if (entry === undefined) return [];
    return [
      {
        commitId: GitOid.parse(entry.commitId),
        parents: entry.parents.map((parent) => GitOid.parse(parent)),
        description: entry.description,
        author: entry.author,
        authoredAt: entry.timestamp,
        changeId: entry.changeId,
      },
    ];
  });
}

/** One row's comparison: the interdiff of two commits, or one commit's own
 *  diff. */
export function localDiff(
  from: string | null,
  to: string | null,
): Promise<JjFileDiff[]> {
  if (from !== null && to !== null) return jjInterdiff({ from, to });
  const lone = from ?? to;
  return lone === null ? Promise.resolve([]) : jjDiff({ revision: lone });
}

/** A whole version against what it was built on: one diff from the parents
 *  of its roots to its heads. jj refuses a set with a gap in it, and the
 *  screen shows that error in place of a size. */
export function localSize(ids: string[]): Promise<JjFileDiff[]> {
  return jjDiff({ revision: ids.join("|") });
}
```

## Tests

The tests read diffy's own history around the newest non-empty commit on
trunk, since trunk itself is an empty merge whenever a pull request lands as
one.

```ts
//| id: backend-local-reviews-test
//| file: src/backend/review/local.test.ts
import { describe, expect, test } from "bun:test";
import { applyCommand, EMPTY_REVIEW } from "../../frontend/model/review";
import { jjLog } from "../commit/jj";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  registrationDefaults,
  resolveRegistration,
} from "./local";

async function tipCommit(): Promise<string> {
  const [entry] = await jjLog({ revset: "latest(::trunk() ~ empty())" });
  if (entry === undefined) throw new Error("no history");
  return entry.commitId;
}

describe("resolveRegistration", () => {
  test("names the commits the revset held, oldest first", async () => {
    // arrange
    const tip = "latest(::trunk() ~ empty())";
    const asked = { name: "t", revset: `${tip}- | ${tip}` };

    // act
    const { name, version } = await resolveRegistration(
      EMPTY_REVIEW,
      asked,
      "now",
    );

    // assert
    expect(name).toBe("t");
    expect(version.commits).toHaveLength(2);
    expect(version.commits.at(-1)).toBe(await tipCommit());
    expect(version.revset).toBe(asked.revset);
    expect(version.operation).toMatch(/^[0-9a-f]+$/);
  });

  test("refuses a revset that names nothing", async () => {
    // arrange
    // act
    const attempt = resolveRegistration(
      EMPTY_REVIEW,
      { name: "t", revset: "none()" },
      "now",
    );

    // assert
    expect(attempt).rejects.toBeInstanceOf(RegistrationError);
  });
});

describe("registrationDefaults", () => {
  test("takes the revset of the review's last version", async () => {
    // arrange
    const document = applyCommand(EMPTY_REVIEW, {
      kind: "register",
      name: "t",
      version: {
        operation: "o1",
        revset: "trunk()",
        commits: ["c"],
        registeredAt: "then",
      },
    });

    // act
    const defaults = await registrationDefaults(document, { name: "t" });

    // assert
    expect(defaults.revset).toBe("trunk()");
  });

  test("reads a new name as the bookmark of that name", async () => {
    // arrange
    // act
    const defaults = await registrationDefaults(EMPTY_REVIEW, {
      name: "my-branch",
    });

    // assert
    expect(defaults.name).toBe("my-branch");
    expect(defaults.revset).toBe('trunk().."my-branch"');
  });
});

describe("reading a version", () => {
  test("reads commits in the order asked, with their change ids", async () => {
    // arrange
    const tip = "latest(::trunk() ~ empty())";
    const entries = await jjLog({ revset: `${tip}- | ${tip}` });
    const ids = entries.map((entry) => entry.commitId).reverse();

    // act
    const commits = await localCommits(ids);

    // assert
    expect(commits.map((commit) => commit.commitId).join()).toBe(ids.join());
    expect(commits.every((commit) => commit.changeId !== null)).toBe(true);
  });

  test("diffs a lone commit, a pair, and a whole version", async () => {
    // arrange
    const tip = "latest(::trunk() ~ empty())";
    const [newer, older] = (await jjLog({ revset: `${tip} | ${tip}-` })).map(
      (entry) => entry.commitId,
    );
    if (newer === undefined || older === undefined) throw new Error("history");

    // act
    const lone = await localDiff(null, newer);
    const pair = await localDiff(older, newer);
    const whole = await localSize([older, newer]);

    // assert
    expect(lone.length).toBeGreaterThan(0);
    expect(Array.isArray(pair)).toBe(true);
    expect(whole.length).toBeGreaterThanOrEqual(lone.length);
  });
});
```
