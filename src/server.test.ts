// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[init]
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import type { GitHubGraphQL } from "./backend/commit/github";
import { jjDiff, jjDiffBetween, jjInterdiff, jjLog } from "./backend/commit/jj";
import {
  handleDiff,
  handleGithubPullCommits,
  handleGithubPullHistory,
  handleGithubPulls,
  handleInterdiff,
  handleLog,
  handleOperations,
  handleSource,
  pullDiffResponse,
} from "./server";

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    // act
    const res = await handleLog(new Request("http://test/api/log"));
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("reports an unknown operation as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request("http://test/api/log?op=no-such-op-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});

describe("handleOperations", () => {
  test("returns the operation log as a non-empty array", async () => {
    // arrange
    // act
    const res = await handleOperations();
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("handleDiff", () => {
  test("returns the revision and its file diffs", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=root()%2B"),
    );

    // assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: string; files: unknown[] };
    expect(body.revision).toBe("root()+");
    expect(body.files.length).toBeGreaterThan(0);
  });

  test("defaults the revision to @", async () => {
    // arrange
    // act
    const res = await handleDiff(new Request("http://test/api/diff"));
    const body = (await res.json()) as { revision: string };

    // assert
    expect(res.status).toBe(200);
    expect(body.revision).toBe("@");
  });

  test("reports an unresolvable revision as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=no-such-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });
});

describe("handleSource", () => {
  const source = (params: Record<string, string>) =>
    handleSource(
      new Request(`http://test/api/source?${new URLSearchParams(params)}`),
    );

  test("answers a blob's lines, highlighted as its path says", async () => {
    // arrange
    const blob = (
      await $`git rev-parse HEAD:package.json`.quiet().text()
    ).trim();

    // act
    const res = await source({ blob, path: "package.json" });
    const body = (await res.json()) as { language: string; lines: unknown[] };

    // assert
    expect(res.status).toBe(200);
    expect(body.language).toBe("json");
    expect(body.lines.length).toBeGreaterThan(0);
  });

  test("reports a blob the store does not hold as 404", async () => {
    // arrange
    // act
    const res = await source({ blob: "f".repeat(40), path: "a.ts" });

    // assert
    expect(res.status).toBe(404);
  });

  test("reports a request without a usable blob id as 400", async () => {
    // arrange
    // act
    const res = await source({ blob: "HEAD", path: "a.ts" });

    // assert
    expect(res.status).toBe(400);
  });
});

describe("handleInterdiff", () => {
  function request(params: [string, string][]): Request {
    return new Request(
      `http://test/api/interdiff?${new URLSearchParams(params)}`,
    );
  }

  async function rowsFor(params: [string, string][]) {
    const res = await handleInterdiff(request(params));
    const body = (await res.json()) as {
      rows: {
        from: { commitId: string } | null;
        to: { commitId: string } | null;
        files: { status: string }[];
      }[];
    };
    expect(res.status).toBe(200);
    return body.rows;
  }

  test("pairs one commit against another", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const rows = await rowsFor([
      ["from", from],
      ["to", to],
    ]);

    // assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from?.commitId).toBe(from);
    expect(rows[0]?.to?.commitId).toBe(to);
    expect(rows[0]?.files.length).toBeGreaterThan(0);
  });

  test("lines up a series against itself, one row per commit", async () => {
    // arrange
    const ids = (await jjLog({ revset: "root()+::", limit: 3 })).map(
      (entry) => entry.commitId,
    );
    const params: [string, string][] = [
      ...ids.map((id): [string, string] => ["from", id]),
      ...ids.map((id): [string, string] => ["to", id]),
    ];

    // act
    const rows = await rowsFor(params);

    // assert
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) {
      expect(row.from?.commitId).toBe(row.to?.commitId as string);
      expect(row.files).toEqual([]);
    }
  });

  test("gives a commit with no opposite number its own diff", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const rows = await rowsFor([["to", to]]);

    // assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from).toBeNull();
    expect(rows[0]?.to?.commitId).toBe(to);
    for (const file of rows[0]?.files ?? []) {
      expect(file.status).toBe("added");
    }
  });

  test("reports a request with no commits as 400", async () => {
    // arrange
    // act
    const res = await handleInterdiff(request([]));
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/at least one commit/);
  });

  test("reports an unresolvable commit as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleInterdiff(
      request([
        ["from", "no-such-xyz"],
        ["to", "@"],
      ]),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });

  test("keeps interdiff rows free of review fields", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const rows = await rowsFor([["to", to]]);

    // assert
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["files", "from", "to"]);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[1]

describe("the GitHub routes", () => {
  test("reports a repo that is not owner/name as 400", async () => {
    // arrange
    // act
    const res = await handleGithubPulls(
      new Request("http://test/api/github/pulls?repo=diffy"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/owner\/name/);
  });

  test("reports a missing pull request number as 400", async () => {
    // arrange
    // act
    const res = await handleGithubPullHistory(
      new Request("http://test/api/github/pull/history?repo=glencbz/diffy"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
  });

  test("reports a head that is not a 40-hex oid as 400", async () => {
    // arrange
    const url =
      "http://test/api/github/pull/commits?repo=glencbz/diffy&number=9&head=nope";

    // act
    const res = await handleGithubPullCommits(new Request(url));
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/40-character/);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[2]

describe("pullDiffResponse", () => {
  /** A pull request whose base and heads are commits every clone of this repo has. */
  async function localPull(): Promise<{ base: string; heads: string[] }> {
    return {
      base: await commitId("root()+"),
      heads: [await commitId("root()++"), await commitId("root()+++")],
    };
  }

  /** A transport that answers the history query for that pull request. */
  function stubHistory(base: string, heads: string[]): GitHubGraphQL {
    return () =>
      Promise.resolve({
        data: {
          repository: {
            pullRequest: {
              number: 9,
              headRefOid: heads.at(-1),
              baseRefName: "main",
              baseRefOid: base,
              timelineItems: {
                pageInfo: { hasNextPage: false },
                nodes: heads.slice(1).map((after, index) => ({
                  createdAt: "2026-09-01T10:00:00Z",
                  beforeCommit: { oid: heads[index] },
                  afterCommit: { oid: after },
                })),
              },
            },
          },
        },
      });
  }

  const unreachable: GitHubGraphQL = () =>
    Promise.reject(new Error("the transport should not have been reached"));

  function query(extra: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      repo: "glencbz/diffy",
      number: "9",
      ...extra,
    });
  }

  /** A base and a head that have diverged, with the commit they share. The
   *  base must carry something that commit does not, or a diff from the base
   *  and a diff from the merge base would be the same diff either way. */
  async function divergedPull(): Promise<{
    base: string;
    head: string;
    mergeBase: string;
  }> {
    for (const merge of await jjLog({ revset: "merges() & ::trunk()" })) {
      const [left, right] = merge.parents;
      if (left === undefined || right === undefined) continue;
      const [shared] = await jjLog({
        revset: `heads(::${left} & ::${right})`,
        limit: 1,
      });
      if (shared === undefined) continue;

      const mergeBase = shared.commitId;
      if (mergeBase === left || mergeBase === right) continue;
      for (const [base, head] of [
        [left, right],
        [right, left],
      ] as [string, string][]) {
        const [moved] = await jjLog({
          revset: `(${mergeBase}..${base}) ~ empty()`,
          limit: 1,
        });
        if (moved !== undefined) return { base, head, mergeBase };
      }
    }
    throw new Error("this repo has no merge of two diverged histories");
  }

  async function body(res: Response) {
    return (await res.json()) as {
      from: { kind: string; head?: string };
      to: string;
      files: { status: string; path?: string; newPath?: string }[];
      error?: string;
    };
  }

  function paths(files: { path?: string; newPath?: string }[]): string[] {
    return files.map((file) => file.path ?? file.newPath ?? "");
  }

  test("interdiffs two heads of the same pull request", async () => {
    // arrange
    const { base, heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      query({ from: earlier, to: later }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.from).toEqual({ kind: "version", head: earlier });
    expect(answer.to).toBe(later);
    expect(answer.files).toEqual(
      await jjInterdiff({ from: earlier, to: later }),
    );
    expect(paths(answer.files)).toContain("JJ-COMMIT-DESCRIPTION");
  });

  test("leaves the whole-head diff untouched when no commit scope is given", async () => {
    // arrange
    const { base, heads } = await localPull();
    const later = heads.at(-1) as string;

    // act
    const res = await pullDiffResponse(
      query({ from: "base", to: later }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(
      await jjDiffBetween({ from: base, to: later }),
    );
  });

  test("fromCommit and toCommit together interdiff those two commits", async () => {
    // arrange
    const { base, heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      query({ from: earlier, to: later, fromCommit: base, toCommit: earlier }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(
      await jjInterdiff({ from: base, to: earlier }),
    );
    expect(answer.files).not.toEqual(
      await jjInterdiff({ from: earlier, to: later }),
    );
  });

  test("toCommit alone answers that one commit's own diff", async () => {
    // arrange
    const { base, heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      query({ from: earlier, to: later, toCommit: earlier }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(await jjDiff({ revision: earlier }));
    expect(answer.files).not.toEqual(
      await jjInterdiff({ from: earlier, to: later }),
    );
  });

  test("reports a malformed toCommit the same way as a malformed to", async () => {
    // arrange
    const { heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      query({ from: earlier, to: later, toCommit: "nope" }),
      unreachable,
    );

    // assert
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/40-character/);
  });

  test("reports a head that is not a 40-hex oid as 400, before asking GitHub", async () => {
    // arrange
    // act
    const res = await pullDiffResponse(query({ to: "nope" }), unreachable);

    // assert
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/40-character/);
  });

  test("reports a malformed from the same way as a malformed to", async () => {
    // arrange
    const { heads } = await localPull();

    // act
    const res = await pullDiffResponse(
      query({ from: "nope", to: heads[1] as string }),
      unreachable,
    );

    // assert
    expect(res.status).toBe(400);
  });

  test("reports a missing from as 400, before asking GitHub", async () => {
    // arrange
    const { heads } = await localPull();

    // act
    const res = await pullDiffResponse(
      query({ to: heads[1] as string }),
      unreachable,
    );

    // assert
    expect(res.status).toBe(400);
  });

  test("diffs the base against a head", async () => {
    // arrange
    const { base, heads } = await localPull();
    const later = heads.at(-1) as string;

    // act
    const res = await pullDiffResponse(
      query({ from: "base", to: later }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.from).toEqual({ kind: "base" });
    expect(answer.files).toEqual(
      await jjDiffBetween({ from: base, to: later }),
    );
  });

  test("measures a diverged base from the commit the head grew out of", async () => {
    // arrange
    const { base, head, mergeBase } = await divergedPull();

    // act
    const res = await pullDiffResponse(
      query({ from: "base", to: head }),
      stubHistory(base, [head]),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(
      await jjDiffBetween({ from: mergeBase, to: head }),
    );
    expect(answer.files).not.toEqual(
      await jjDiffBetween({ from: base, to: head }),
    );
  });

  test("refuses the base as the after end", async () => {
    // arrange
    const { heads } = await localPull();

    // act
    const res = await pullDiffResponse(
      query({ from: heads[0] as string, to: "base" }),
      unreachable,
    );

    // assert
    expect(res.status).toBe(400);
  });

  test("reports a head this pull request never had as 404", async () => {
    // arrange
    const { base, heads } = await localPull();
    const stranger = "f".repeat(40);

    // act
    const res = await pullDiffResponse(
      query({ from: heads[0] as string, to: stranger }),
      stubHistory(base, heads),
    );

    // assert
    expect(res.status).toBe(404);
    expect((await body(res)).error).toMatch(/never had head/);
  });
});
// ~/~ end
