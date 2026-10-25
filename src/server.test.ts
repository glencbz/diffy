// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  AgentListeners,
  LISTEN_PATH,
  waitFor,
} from "./backend/agent/listeners";
import { ToolError } from "./backend/agent/mcp";
import type { GitHubGraphQL } from "./backend/commit/github";
import { jjDiff, jjDiffBetween, jjInterdiff, jjLog } from "./backend/commit/jj";
import { hostFrom } from "./backend/host/host";
import { AgentWorkspaces, type RepoContext } from "./backend/repo/repos";
import { openReviewStore, watchReview } from "./backend/review/store";
import {
  agentContext,
  agentListen,
  handleCompare,
  handleComparePaths,
  handleDiff,
  handleGithubPullCommits,
  handleGithubPullHistory,
  handleGithubPulls,
  handleInterdiff,
  handleLog,
  handleOperations,
  handleSource,
  localReviewsRoute,
  pullDiffResponse,
  REVIEW_TOPIC,
  reviewChanges,
  reviewRoute,
  sockets,
} from "./server";

/** The repository these tests read. */
const ROOT = process.cwd();
const REPO: RepoContext = { root: ROOT, store: openReviewStore(":memory:") };
const HOST = { now: () => new Date(), diffy: ["diffy"] };
const ORIGINS = { reader: "http://vm", agent: "http://localhost:4000" };

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog(ROOT, { revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    // act
    const res = await handleLog(new Request("http://test/api/log"), REPO);
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("reads only what a revset names", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request("http://test/api/log?revset=@"),
      REPO,
    );
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  test("reports an unknown operation as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request("http://test/api/log?op=no-such-op-xyz"),
      REPO,
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
    const res = await handleOperations(new Request("http://test/"), REPO);
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
      REPO,
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
    const res = await handleDiff(new Request("http://test/api/diff"), REPO);
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
      REPO,
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
      REPO,
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

describe("the compare routes", () => {
  const get = (
    handler: (req: Request, repo: RepoContext) => Promise<Response>,
    params: Record<string, string>,
  ) =>
    handler(new Request(`http://test/?${new URLSearchParams(params)}`), REPO);

  test("answers one file diffed against another path", async () => {
    // arrange
    const toCommit = (await $`git rev-parse main`.quiet().text()).trim();

    // act
    const res = await get(handleCompare, {
      toCommit,
      oldPath: "package.json",
      newPath: "tsconfig.json",
    });
    const body = (await res.json()) as { file: { status: string } };

    // assert
    expect(res.status).toBe(200);
    expect(body.file.status).toBe("renamed");
  });

  test("lists the before side's paths", async () => {
    // arrange
    const toCommit = (await $`git rev-parse main`.quiet().text()).trim();

    // act
    const res = await get(handleComparePaths, { toCommit });
    const body = (await res.json()) as { paths: string[] };

    // assert
    expect(res.status).toBe(200);
    expect(body.paths).toContain("package.json");
  });

  test("reports a path the side does not hold as 400", async () => {
    // arrange
    const toCommit = (await $`git rev-parse main`.quiet().text()).trim();

    // act
    const res = await get(handleCompare, {
      toCommit,
      oldPath: "no/such/file",
      newPath: "package.json",
    });

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
    const res = await handleInterdiff(request(params), REPO);
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
    const ids = (await jjLog(ROOT, { revset: "root()+::", limit: 3 })).map(
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
    const res = await handleInterdiff(request([]), REPO);
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
      REPO,
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
    const res = await handleGithubPullCommits(new Request(url), REPO);
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/40-character/);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[2]

describe("the review route", () => {
  interface Route {
    GET: () => Response;
    POST: (req: Request) => Promise<Response>;
  }

  async function withStore(
    run: (route: Route, submits: unknown[][]) => Promise<void>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    const repo = { root: ROOT, store: openReviewStore(join(dir, "r.sqlite")) };
    const submits: unknown[][] = [];
    const route = reviewRoute({
      submitted: async (...args) => {
        submits.push(args);
        return 0;
      },
    });
    try {
      await run(
        {
          GET: () => route.GET(new Request("http://test/"), repo),
          POST: (req) => route.POST(req, repo),
        },
        submits,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  function post(body: unknown): Request {
    return new Request("http://test/api/review", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  test("answers a command with the document it left", () =>
    withStore(async (route) => {
      // arrange
      const command = {
        kind: "set-seen",
        comparison: {
          reviewKey: "change:a",
          fromCommitId: null,
          toCommitId: "a",
        },
        seen: true,
        at: "2026-09-28T09:00:00.000Z",
      };

      // act
      const res = await route.POST(post(command));
      const read = await (await route.GET()).json();

      // assert
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(read);
      expect(read.revision).toBe(1);
      expect(read.document.marks).toHaveLength(1);
    }));

  test("tells agents only of a mark on a local review's newest version", () =>
    withStore(async (route, submits) => {
      // arrange
      for (const commit of ["a", "b"]) {
        const version = {
          operation: `op-${commit}`,
          revset: "t",
          commits: [commit],
          registeredAt: "2026-10-22T09:00:00.000Z",
        };
        await route.POST(post({ kind: "register", name: "t", version }));
      }
      const mark = (series: string, version: string) =>
        route.POST(
          post({
            kind: "mark-reviewed",
            series,
            version,
            at: "2026-10-22T10:00:00.000Z",
          }),
        );

      // act
      await mark("local:t", "1");
      await mark("pull:o/r#1", "abc");
      await mark("local:t", "2");

      // assert
      expect(submits).toEqual([[ROOT, "t", 2]]);
    }));

  test("reports a body that is not a command as 400 and writes nothing", () =>
    withStore(async (route) => {
      // arrange
      // act
      const res = await route.POST(post({ kind: "set-seen" }));
      const read = await (await route.GET()).json();

      // assert
      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe(
        "string",
      );
      expect(read.revision).toBe(0);
    }));

  test("registers a local review and answers with its name", async () => {
    // arrange
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    const store = openReviewStore(join(dir, "r.sqlite"));
    const post = (body: unknown) =>
      localReviewsRoute(() => new Date()).POST(
        new Request("http://test/api/local/reviews", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        { root: ROOT, store },
      );

    try {
      // act
      const res = await post({ name: "t", revset: "trunk()" });
      const refused = await post({ name: "t", revset: "none()" });

      // assert
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        name: string;
        snapshot: { document: { localReviews: unknown[] } };
      };
      expect(body.name).toBe("t");
      expect(body.snapshot.document.localReviews).toHaveLength(1);
      expect(refused.status).toBe(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("announces a new revision to an open socket", async () => {
    // arrange
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    const store = openReviewStore(join(dir, "r.sqlite"));
    const server = Bun.serve({
      port: 0,
      routes: { "/api/review/changes": reviewChanges },
      websocket: sockets(new AgentListeners()),
    });
    const stop = watchReview(
      store,
      (revision) => server.publish(REVIEW_TOPIC, JSON.stringify({ revision })),
      10,
    );
    const socket = new WebSocket(
      `ws://localhost:${server.port}/api/review/changes`,
    );
    const heard = new Promise<unknown>((resolve) => {
      socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
    });
    await new Promise((resolve) => {
      socket.onopen = resolve;
    });

    try {
      // act
      store.apply({ kind: "delete-comment", id: "none" });

      // assert
      expect(await heard).toEqual({ revision: 1 });
    } finally {
      socket.close();
      stop();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("tells a waiting agent of a submit, and a late one at once", async () => {
    // arrange
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    const store = openReviewStore(join(dir, "r.sqlite"));
    const listeners = new AgentListeners();
    const server = Bun.serve({
      port: 0,
      routes: {
        [LISTEN_PATH]: agentListen(async (workspace) => {
          if (workspace !== ROOT) {
            throw new Error(`no workspace at ${workspace}`);
          }
          return { root: ROOT, store };
        }),
      },
      websocket: sockets(listeners),
    });
    const wait = (review: string, workspace = ROOT) =>
      waitFor(review, workspace, async () => new URL("/mcp", server.url), 10);
    store.apply({
      kind: "register",
      name: "t",
      version: {
        operation: "op",
        revset: "t",
        commits: ["a"],
        registeredAt: "2026-10-24T09:00:00.000Z",
      },
    });

    try {
      // act
      const waited = wait("t");
      // The route tells the listeners once the reader's mark is written.
      while ((await listeners.submitted(ROOT, "t", 1)) === 0) {
        await Bun.sleep(10);
      }
      store.apply({
        kind: "mark-reviewed",
        series: "local:t",
        version: "1",
        at: "2026-10-24T10:00:00.000Z",
      });
      const late = await wait("t");
      const missing = await wait("u");
      const stranger = await wait("t", "/nowhere");

      // assert
      expect(await waited).toEqual({ review: "t", version: 1 });
      expect(late).toEqual({ review: "t", version: 1 });
      expect(missing).toEqual({ error: "no local review is named u" });
      expect(stranger).toEqual({ error: "no workspace at /nowhere" });
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[3]

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
   *  and a diff from the merge base would be the same diff either way. Both
   *  sides stay small, because difftastic takes seconds on a big diff and the
   *  test would time out. */
  async function divergedPull(): Promise<{
    base: string;
    head: string;
    mergeBase: string;
  }> {
    for (const merge of await jjLog(ROOT, { revset: "merges() & ::trunk()" })) {
      const [left, right] = merge.parents;
      if (left === undefined || right === undefined) continue;
      const [shared] = await jjLog(ROOT, {
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
        const [moved] = await jjLog(ROOT, {
          revset: `(${mergeBase}..${base}) ~ empty()`,
          limit: 1,
        });
        if (moved === undefined) continue;
        const [onBase, onHead] = await Promise.all(
          [base, head].map(async (side) => {
            const names =
              await $`jj diff --name-only --from ${mergeBase} --to ${side}`
                .quiet()
                .text();
            return names.split("\n").filter(Boolean).length;
          }),
        );
        if ((onBase ?? 0) <= 3 && (onHead ?? 0) <= 3) {
          return { base, head, mergeBase };
        }
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
      ROOT,
      query({ from: earlier, to: later }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.from).toEqual({ kind: "version", head: earlier });
    expect(answer.to).toBe(later);
    expect(answer.files).toEqual(
      await jjInterdiff(ROOT, { from: earlier, to: later }),
    );
    expect(paths(answer.files)).toContain("JJ-COMMIT-DESCRIPTION");
  });

  test("fromCommit and toCommit together interdiff those two commits", async () => {
    // arrange
    const { base, heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      ROOT,
      query({ from: earlier, to: later, fromCommit: base, toCommit: earlier }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(
      await jjInterdiff(ROOT, { from: base, to: earlier }),
    );
    expect(answer.files).not.toEqual(
      await jjInterdiff(ROOT, { from: earlier, to: later }),
    );
  });

  test("toCommit alone answers that one commit's own diff", async () => {
    // arrange
    const { base, heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      ROOT,
      query({ from: earlier, to: later, toCommit: earlier }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(await jjDiff(ROOT, { revision: earlier }));
    expect(answer.files).not.toEqual(
      await jjInterdiff(ROOT, { from: earlier, to: later }),
    );
  });

  test("reports a malformed toCommit the same way as a malformed to", async () => {
    // arrange
    const { heads } = await localPull();
    const [earlier, later] = heads as [string, string];

    // act
    const res = await pullDiffResponse(
      ROOT,
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
    const res = await pullDiffResponse(
      ROOT,
      query({ to: "nope" }),
      unreachable,
    );

    // assert
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/40-character/);
  });

  test("reports a malformed from the same way as a malformed to", async () => {
    // arrange
    const { heads } = await localPull();

    // act
    const res = await pullDiffResponse(
      ROOT,
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
      ROOT,
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
      ROOT,
      query({ from: "base", to: later }),
      stubHistory(base, heads),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.from).toEqual({ kind: "base" });
    expect(answer.files).toEqual(
      await jjDiffBetween(ROOT, { from: base, to: later }),
    );
  });

  test("measures a diverged base from the commit the head grew out of", async () => {
    // arrange
    const { base, head, mergeBase } = await divergedPull();

    // act
    const res = await pullDiffResponse(
      ROOT,
      query({ from: "base", to: head }),
      stubHistory(base, [head]),
    );
    const answer = await body(res);

    // assert
    expect(res.status).toBe(200);
    expect(answer.files).toEqual(
      await jjDiffBetween(ROOT, { from: mergeBase, to: head }),
    );
    const fromBase = await $`jj diff --name-only --from ${base} --to ${head}`
      .quiet()
      .text();
    expect(paths(answer.files).sort()).not.toEqual(
      fromBase.split("\n").filter(Boolean).sort(),
    );
  });

  test("refuses the base as the after end", async () => {
    // arrange
    const { heads } = await localPull();

    // act
    const res = await pullDiffResponse(
      ROOT,
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
      ROOT,
      query({ from: heads[0] as string, to: stranger }),
      stubHistory(base, heads),
    );

    // assert
    expect(res.status).toBe(404);
    expect((await body(res)).error).toMatch(/never had head/);
  });
});

describe("agentContext", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "diffy-agents-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A fresh jj repository, and a second workspace of it. */
  async function repoWithWorkspace(name: string) {
    const root = join(dir, name);
    await $`jj git init ${root}`.quiet();
    const second = join(dir, `${name}-ws`);
    await $`jj workspace add ${second}`.cwd(root).quiet();
    return { root, second };
  }

  test("runs a named workspace's call there, and links the reader to it", async () => {
    // arrange
    const reader = await repoWithWorkspace("reader");
    const agent = await repoWithWorkspace("agent");
    const shown = {
      root: reader.root,
      store: openReviewStore(join(dir, "reader.sqlite")),
    };
    const agents = new AgentWorkspaces(hostFrom({ XDG_DATA_HOME: dir }, dir));
    const context = (caller: string | null) =>
      agentContext(HOST, { context: () => shown }, agents, ORIGINS, caller);

    // act
    const elsewhere = await context(agent.second);
    const sibling = await context(reader.second);
    const unnamed = await context(null);
    elsewhere.repo.store.apply({
      kind: "set-seen",
      comparison: {
        reviewKey: "change:a",
        fromCommitId: null,
        toCommitId: "a",
      },
      seen: true,
      at: "2026-10-19T09:00:00.000Z",
    });

    // assert
    expect(elsewhere.repo.root).toBe(agent.second);
    expect(elsewhere.link("/reviews/x")).toBe(
      `http://vm/reviews/x?repo=${encodeURIComponent(agent.second)}`,
    );
    expect(sibling.repo.root).toBe(reader.second);
    expect(sibling.link("/reviews/x")).toBe("http://vm/reviews/x");
    expect(sibling.wait("my t")).toBe(
      "diffy wait 'my t' --url http://localhost:4000",
    );
    expect(unnamed.repo).toBe(shown);
    expect((await context(agent.root)).repo.store).toBe(elsewhere.repo.store);
    // The agent's write went to its own repository's store.
    expect(shown.store.revision()).toBe(0);
    expect((await context(agent.root)).repo.store.revision()).toBe(1);
  });

  test("fails a call from a path that is no workspace", async () => {
    // arrange
    const agents = new AgentWorkspaces(hostFrom({ XDG_DATA_HOME: dir }, dir));

    // act
    const call = agentContext(
      HOST,
      { context: () => null },
      agents,
      ORIGINS,
      dir,
    );

    // assert
    await expect(call).rejects.toBeInstanceOf(ToolError);
  });
});
// ~/~ end
