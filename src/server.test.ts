// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[init]
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  AgentListeners,
  follow,
  LISTEN_PATH,
  waitFor,
} from "./backend/agent/listeners";
import type { RepoContext } from "./backend/repo/repos";
import { openReviewStore, watchReview } from "./backend/review/store";
import {
  agentListen,
  handleCompare,
  handleComparePaths,
  handleInterdiff,
  handleLog,
  handleOperations,
  handleSource,
  localReviewsRoute,
  reviewChanges,
  reviewRoute,
  sockets,
} from "./server";
import { FIXED, scratchRepo } from "./testing/history";

/** The repository these tests read. */
const ROOT = process.cwd();
const REPO: RepoContext = {
  root: ROOT,
  store: openReviewStore(":memory:"),
  topic: "test",
};
const _HOST = { now: () => new Date(), diffy: ["diffy"] };
const _ORIGINS = { reader: "http://vm", agent: "http://localhost:4000" };

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    const scratch = await scratchRepo();

    try {
      // act
      const res = await handleLog(new Request("http://test/api/log"), {
        ...REPO,
        root: scratch.root,
      });
      const body = (await res.json()) as unknown[];

      // assert
      expect(res.status).toBe(200);
      expect(body).toHaveLength(4);
    } finally {
      await scratch.remove();
    }
  });

  test("reads only what a revset names", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request(`http://test/api/log?revset=${FIXED.commit}`),
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

describe("handleSource", () => {
  const source = (params: Record<string, string>) =>
    handleSource(
      new Request(`http://test/api/source?${new URLSearchParams(params)}`),
      REPO,
    );

  test("answers a blob's lines, highlighted as its path says", async () => {
    // arrange
    const blob = (
      await $`git rev-parse ${FIXED.commit}:package.json`.quiet().text()
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
    const toCommit = FIXED.commit;

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
    const toCommit = FIXED.commit;

    // act
    const res = await get(handleComparePaths, { toCommit });
    const body = (await res.json()) as { paths: string[] };

    // assert
    expect(res.status).toBe(200);
    expect(body.paths).toContain("package.json");
  });

  test("reports a path the side does not hold as 400", async () => {
    // arrange
    const toCommit = FIXED.commit;

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
    const { first: from, second: to } = FIXED;

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
    const ids = [FIXED.first, FIXED.second, FIXED.third];
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
    const to = FIXED.first;

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
        ["to", FIXED.commit],
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
    const to = FIXED.first;

    // act
    const rows = await rowsFor([["to", to]]);

    // assert
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["files", "from", "to"]);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[1]

describe("the review route", () => {
  interface Route {
    GET: () => Response;
    POST: (req: Request) => Promise<Response>;
  }

  async function withStore(
    run: (route: Route, told: unknown[][]) => Promise<void>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    const repo = {
      root: ROOT,
      store: openReviewStore(join(dir, "r.sqlite")),
      topic: "t",
    };
    const told: unknown[][] = [];
    const route = reviewRoute({
      tell: async (...args) => {
        told.push(args);
        return 0;
      },
    });
    try {
      await run(
        {
          GET: () => route.GET(new Request("http://test/"), repo),
          POST: (req) => route.POST(req, repo),
        },
        told,
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

  test("tells agents only of a mark on a local review's newest version, and its first delete", () =>
    withStore(async (route, told) => {
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
      await mark("other:1", "abc");
      await mark("local:t", "2");
      for (const at of [
        "2026-10-22T11:00:00.000Z",
        "2026-10-22T12:00:00.000Z",
      ]) {
        await route.POST(post({ kind: "forget-review", name: "t", at }));
      }
      await route.POST(post({ kind: "forget-review", name: "u", at: "t" }));

      // assert
      expect(told).toEqual([
        [ROOT, { review: "t", version: 2 }],
        [ROOT, { review: "t", deleted: true }],
      ]);
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
        { root: ROOT, store, topic: "t" },
      );

    try {
      // act
      const res = await post({ name: "t", revset: FIXED.commit });
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
    const store = openReviewStore(":memory:");
    const server = Bun.serve({
      port: 0,
      routes: {
        "/api/review/changes": (req, server) =>
          reviewChanges(req, server, { root: ROOT, store, topic: "t" }),
      },
      websocket: sockets(new AgentListeners()),
    });
    const stop = watchReview(
      store,
      (revision) => server.publish("t", JSON.stringify({ revision })),
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
    }
  });

  test("tells waiting and following agents of a submit, and a late one of a submit or delete at once", async () => {
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
          return { root: ROOT, store, topic: "t" };
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

    const followed: unknown[] = [];
    let up = true;
    void follow(
      ROOT,
      async () => (up ? new URL("/mcp", server.url) : null),
      (event) => followed.push(event),
      10,
    );

    try {
      // act
      const waited = wait("t");
      // The route tells the listeners once the reader's mark is written.
      while ((await listeners.tell(ROOT, { review: "t", version: 1 })) < 2) {
        await Bun.sleep(10);
      }
      store.apply({
        kind: "mark-reviewed",
        series: "local:t",
        version: "1",
        at: "2026-10-24T10:00:00.000Z",
      });
      const late = await wait("t");
      store.apply({
        kind: "forget-review",
        name: "t",
        at: "2026-10-24T11:00:00.000Z",
      });
      const gone = await wait("t");
      const missing = await wait("u");
      const stranger = await wait("t", "/nowhere");
      const lost = await follow(
        "/nowhere",
        async () => new URL("/mcp", server.url),
        () => {},
        10,
      );

      // assert
      expect(await waited).toEqual({ review: "t", version: 1 });
      expect(late).toEqual({ review: "t", version: 1 });
      expect(gone).toEqual({ review: "t", deleted: true });
      expect(missing).toEqual({ error: "no local review is named u" });
      expect(stranger).toEqual({ error: "no workspace at /nowhere" });
      expect(lost).toEqual({ error: "no workspace at /nowhere" });
      expect(followed.at(-1)).toEqual({ review: "t", version: 1 });
    } finally {
      up = false;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
// ~/~ end
