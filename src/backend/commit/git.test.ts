// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  BlobId,
  GitOid,
  gitBlob,
  gitBlobBytes,
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[1]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[2]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[3]

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

  test("reads a blob back as the bytes it was stored as", async () => {
    // arrange
    const id = BlobId.parse(
      (await $`git rev-parse HEAD:package.json`.quiet().text()).trim(),
    );

    // act
    const bytes = await gitBlobBytes(id);

    // assert
    expect(bytes).toEqual(
      (await $`git show HEAD:package.json`.quiet()).bytes(),
    );
  });
});
// ~/~ end
