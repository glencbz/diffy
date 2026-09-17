// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import {
  GitOid,
  gitForget,
  gitHasCommit,
  gitLog,
  gitMaterialize,
  parseLogRecord,
  RefPath,
} from "./git";

/** The oid `revision` names, as this repo's git store has it. */
async function oidOf(revision: string): Promise<GitOid> {
  return GitOid.parse(
    (await $`git rev-parse ${revision}`.quiet().text()).trim(),
  );
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
    const [base, head] = await gitMaterialize([
      pin(await oidOf("HEAD~1")),
      pin(await oidOf("HEAD")),
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
// ~/~ end
