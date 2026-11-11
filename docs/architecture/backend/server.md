# Backend

## Web server

A just rule runs the backend:

```just
#| id: just-bun
# Run the app on this workspace
@run port="3000":
  {{nix_runtime}} bun run src/cli.ts . --port {{port}}

```

Handlers and the route table are exported so tests call them without a
port; only [the command line](cli.md) binds one. `just run` keeps dev mode
and hot reload; a server shared through the proxy needs production mode (see
[serving](../../devtools/serving.md)). `jjJson` turns a `JjError` into a 400
for every jj-backed route.

```ts
//| id: backend-server
//| file: src/server.ts

import * as z from "zod";
import { componentTools } from "./backend/agent/components";
import { evidenceTools } from "./backend/agent/evidence";
import {
  type AgentListeners,
  type Heard,
  LISTEN_PATH,
  type ReviewEvent,
} from "./backend/agent/listeners";
import { mcpRoute, type ToolContext, ToolError } from "./backend/agent/mcp";
import { recordingTools } from "./backend/agent/recording";
import { INSTRUCTIONS, reviewTools, turnOf } from "./backend/agent/review";
import { runTools } from "./backend/agent/runs";
import {
  beforePaths,
  CompareError,
  compareFiles,
} from "./backend/commit/compare";
import { BlobId, GitOid, gitBlob } from "./backend/commit/git";
import {
  JjError,
  type JjFileDiff,
  type JjLogEntry,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
import { playwrightRecorder } from "./backend/evidence/recorder";
import { EvidenceStore, evidenceRoutes } from "./backend/evidence/store";
import type { Host } from "./backend/host/host";
import { LayoutStore, layoutRoutes } from "./backend/layouts/layouts";
import {
  type DefaultRepo,
  type RecentRepos,
  type RepoContext,
  repoRoutes,
  type Workspaces,
} from "./backend/repo/repos";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  resolveRegistration,
} from "./backend/review/local";
import { highlightSource } from "./backend/syntax/highlight";
import index from "./frontend/index.html";
import { type AlignedPair, alignSeries } from "./model/alignment";
import {
  localReview,
  localSeries,
  ReviewCommand,
  type ReviewDocument,
} from "./model/review";

/** Run a jj-backed handler body; a rejected revset/operation becomes a 400. */
async function jjJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof JjError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export function handleLog(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const atOperation = params.get("op") ?? undefined;
  const revset = params.get("revset") ?? undefined;
  return jjJson(() => jjLog(root, { revset, atOperation }));
}

export function handleOperations(
  _req: Request,
  { root }: RepoContext,
): Promise<Response> {
  // The one read that snapshots: live refresh sees an edit as an operation.
  return jjJson(() => jjOpLog(root, { limit: 200, snapshot: true }));
}
```

`/api/interdiff` takes `from` and `to` commit ids, each in `jj log` order,
and answers one row per pair [`alignSeries`](series.md) lines up. Commit ids,
because the two sides usually come from different operations. A lone side is
an add or a drop and shows its own diff, which also makes "one `to`, no `from`"
plain single-commit viewing with no separate endpoint.

```ts
//| id: backend-server

export async function handleInterdiff(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const from = params.getAll("from");
  const to = params.getAll("to");

  if (from.length === 0 && to.length === 0) {
    return Response.json(
      { error: "interdiff needs at least one commit" },
      { status: 400 },
    );
  }

  // Rows run concurrently, one jj process each.
  return jjJson(async () => {
    const commits = await jjCommits(root, [...from, ...to]);
    const series = (ids: string[]): JjLogEntry[] =>
      ids.flatMap((id) => {
        const commit = commits.get(id);
        return commit === undefined ? [] : [commit];
      });

    return {
      rows: await Promise.all(
        alignSeries(series(from), series(to)).map(async (pair) => ({
          ...pair,
          files: await pairFiles(root, pair),
        })),
      ),
    };
  });
}

/** A paired row is an interdiff; a lone commit is just its own diff. */
function pairFiles(
  root: string,
  pair: AlignedPair<JjLogEntry>,
): Promise<JjFileDiff[]> {
  if (pair.from !== null && pair.to !== null) {
    return jjInterdiff(root, {
      from: pair.from.commitId,
      to: pair.to.commitId,
    });
  }

  const lone = pair.from ?? pair.to;
  return lone === null
    ? Promise.resolve([])
    : jjDiff(root, { revision: lone.commitId });
}
```

### Reading a file's source

`/api/source` answers one side of one file, whole and
[highlighted](syntax.md). It takes the blob id off the patch's `index` line,
because an interdiff's before side has no commit id, and reads it from git's
store, so it needs no commit to read from. The path only picks the
language.

```ts
//| id: backend-server

export async function handleSource(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const blob = BlobId.safeParse(params.get("blob"));
  const path = params.get("path");

  if (!blob.success || path === null || path === "") {
    return Response.json(
      { error: "source needs a blob id and a path" },
      { status: 400 },
    );
  }

  const text = await gitBlob(root, blob.data);
  if (text === null) {
    return Response.json(
      { error: `no blob ${blob.data} in the object store` },
      { status: 404 },
    );
  }

  return Response.json(await highlightSource(text, path));
}
```

### Comparing two files by hand

`/api/compare` diffs one before-side path of a row against one after-side
path, and `/api/compare/paths` lists what the before side holds to pick from.
Both name the row by its commits, the way
[`/api/local/diff`](#local-reviews) does, because the module reads
[whole trees from git](compare.md); a missing `fromCommit` is a commit's own
diff.

```ts
//| id: backend-server

const CompareParams = z.object({
  fromCommit: GitOid.nullable(),
  toCommit: GitOid,
});

function compareSides(params: URLSearchParams) {
  const { fromCommit, toCommit } = CompareParams.parse({
    fromCommit: params.get("fromCommit"),
    toCommit: params.get("toCommit"),
  });
  return { from: fromCommit, to: toCommit };
}

/** Run a compare handler body; a bad commit or path is the caller's to fix. */
async function compareJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof CompareError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: z.prettifyError(error) }, { status: 400 });
    }
    throw error;
  }
}

export function handleCompare(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => {
    const oldPath = z.string().min(1).parse(params.get("oldPath"));
    const newPath = z.string().min(1).parse(params.get("newPath"));
    return {
      file: await compareFiles(root, compareSides(params), oldPath, newPath),
    };
  });
}

export function handleComparePaths(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => ({
    paths: await beforePaths(root, compareSides(params)),
  }));
}
```

### Reading and writing the review document

`/api/review` is the [review store](review-store.md) over HTTP: `GET` reads
the document, `POST` applies one [command](../frontend/review.md#review-state).
A bad body is a 400 naming what is wrong, for writers other than the browser.

```ts
//| id: backend-server

export const reviewRoute = (listeners: Pick<AgentListeners, "tell">) => ({
  GET: (_req: Request, { store }: RepoContext) => Response.json(store.read()),
  POST: async (req: Request, { root, store }: RepoContext) => {
    const command = ReviewCommand.safeParse(
      await req.json().catch(() => undefined),
    );
    if (!command.success) {
      return Response.json(
        { error: z.prettifyError(command.error) },
        { status: 400 },
      );
    }
    const before = store.read().document;
    const document = store.apply(command.data);
    const event = eventOf(command.data, before, document.document);
    if (event !== null) {
      // The reader is not kept waiting on the agents' workspaces.
      void listeners.tell(root, event);
    }
    return Response.json(document);
  },
});

/** What a command tells the agents: a mark of a local review's newest
 *  version submits it, and forgetting one that was not forgotten deletes
 *  it. */
function eventOf(
  command: ReviewCommand,
  before: ReviewDocument,
  after: ReviewDocument,
): ReviewEvent | null {
  if (command.kind === "forget-review") {
    const review = localReview(before, command.name);
    if (review === undefined || review.forgottenAt !== undefined) return null;
    return { review: review.name, deleted: true };
  }
  if (command.kind !== "mark-reviewed") return null;
  const review = after.localReviews.find(
    (each) => localSeries(each.name) === command.series,
  );
  const version = Number(command.version);
  if (review === undefined || version !== review.versions.length) return null;
  return { review: review.name, version };
}
```

`/api/review/changes` is a WebSocket on which every open screen hears
`{ "revision": n }` when the [store](review-store.md#telling-screens-about-changes)
moves. Writes still go through `POST`, so there is one way to write.
`LISTEN_PATH` is the socket an agent
[waits on the reader at](agents.md#telling-an-agent-the-reader-submitted).
It reads the review as the upgrade is asked for, so a review already
submitted or deleted, or one that does not exist, is answered as soon as the
socket opens. A socket that names no review follows every review in the workspace's
repository, so only a workspace it cannot open answers it at once.

```ts
//| id: backend-server

/** Who is at the other end of a socket: a screen, which hears its
 *  repository's store under `topic`, or an agent
 *  [waiting for the reader to submit](agents.md#telling-an-agent-the-reader-submitted),
 *  and what it hears at once when there is nothing to wait for. */
export type SocketData =
  | { kind: "screen"; topic: string }
  | {
      kind: "agent";
      root: string;
      review: string | null;
      now: Heard | null;
      stop?: () => void;
    };

export function reviewChanges(
  req: Request,
  server: Bun.Server<SocketData>,
  { topic }: RepoContext,
): Response | undefined {
  if (server.upgrade(req, { data: { kind: "screen", topic } })) {
    return undefined;
  }
  return Response.json({ error: "expected a WebSocket" }, { status: 400 });
}

/** `LISTEN_PATH`, for the agent in `workspace` waiting on `review`, or
 *  following every review when it names none. */
export function agentListen(
  context: (workspace: string) => Promise<RepoContext>,
) {
  return async (req: Request, server: Bun.Server<SocketData>) => {
    const asked = new URL(req.url).searchParams;
    const workspace = asked.get("workspace");
    const review = asked.get("review");
    if (workspace === null) {
      return Response.json({ error: "name a workspace" }, { status: 400 });
    }
    const data = await waiting(context, workspace, review);
    if (server.upgrade(req, { data })) return undefined;
    return Response.json({ error: "expected a WebSocket" }, { status: 400 });
  };
}

async function waiting(
  context: (workspace: string) => Promise<RepoContext>,
  workspace: string,
  review: string | null,
): Promise<SocketData> {
  const at = (now: Heard | null, root = workspace): SocketData => ({
    kind: "agent",
    root,
    review,
    now,
  });
  let repo: RepoContext;
  try {
    repo = await context(workspace);
  } catch (error) {
    return at({ error: (error as Error).message });
  }
  if (review === null) return at(null, repo.root);
  const { document } = repo.store.read();
  const named = localReview(document, review);
  if (named === undefined || named.versions.length === 0) {
    return at({ error: `no local review is named ${review}` });
  }
  if (named.forgottenAt !== undefined) {
    return at({ review, deleted: true }, repo.root);
  }
  const { turn, newest } = turnOf(document, named);
  return at(turn === "agent" ? { review, version: newest } : null, repo.root);
}

export function sockets(
  listeners: AgentListeners,
): Bun.WebSocketHandler<SocketData> {
  return {
    open(ws) {
      if (ws.data.kind === "screen") {
        ws.subscribe(ws.data.topic);
        return;
      }
      if (ws.data.now !== null) {
        ws.send(JSON.stringify(ws.data.now));
        return;
      }
      ws.data.stop = listeners.add({
        root: ws.data.root,
        review: ws.data.review,
        send: (line) => ws.send(line),
      });
    },
    close(ws) {
      if (ws.data.kind === "agent") ws.data.stop?.();
    },
    message() {},
  };
}
```

### Local reviews

A `POST` to `/api/local/reviews` registers a [local review](local-reviews.md),
each field left out taking its default, and answers with the name and the
review document it left. An agent declares its work ready this way, and the
commit graph sends the same request with every field filled in, at the
operation the graph is drawn at. `/api/log` takes a `revset` so the graph can
show what a typed one names before it is registered. It is a route rather than a review
command because the server has to evaluate the revset before there is a
version to record. The reads are keyed by commit id.

```ts
//| id: backend-server

const RegistrationBody = z.object({
  name: z.string().min(1).optional(),
  revset: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
});

/** A local-review body; what the repository refuses becomes a 400. */
async function localJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (
      error instanceof RegistrationError ||
      error instanceof JjError ||
      error instanceof z.ZodError
    ) {
      const message =
        error instanceof z.ZodError ? z.prettifyError(error) : error.message;
      return Response.json({ error: message }, { status: 400 });
    }
    throw error;
  }
}

export const localReviewsRoute = (now: () => Date) => ({
  POST: (req: Request, { root, store }: RepoContext) =>
    localJson(async () => {
      const asked = RegistrationBody.parse(await req.json().catch(() => ({})));
      const { name, version } = await resolveRegistration(
        root,
        store.read().document,
        asked,
        now().toISOString(),
      );
      return {
        name,
        snapshot: store.apply({ kind: "register", name, version }),
      };
    }),
});

export function handleLocalCommits(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(() => localCommits(root, ids));
}

export function handleLocalDiff(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return localJson(async () => ({
    files: await localDiff(
      root,
      params.get("fromCommit"),
      params.get("toCommit"),
    ),
  }));
}

export function handleLocalSize(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(async () => ({ files: await localSize(root, ids) }));
}
```

### Routes

Every non-API path serves the page, since the frontend keeps the reader's
place in [the path](../frontend/address.md). An unknown API path is a 404.
Each handler takes the [`RepoContext`](repos.md#a-repository-per-request) it
runs in, and `inRepo` resolves it from the request's `?workspace=`, or the
[default repository](repos.md#a-repository-per-request) when there is none.
The review socket names one too, and listens to that
repository's store alone.

```ts
//| id: backend-server

/** The workspace a browser request names in `?workspace=`, or the
 *  default repository's when it names none. A Response is the refusal. */
async function requested(
  req: Request,
  defaultRepo: DefaultRepo,
  workspaces: Workspaces,
): Promise<RepoContext | Response> {
  const named =
    new URL(req.url).searchParams.get("workspace") ?? defaultRepo.root;
  if (named === null) {
    return Response.json({ error: "no repository is open" }, { status: 409 });
  }
  return workspaces
    .context(named)
    .catch((error: Error) =>
      Response.json({ error: error.message }, { status: 404 }),
    );
}

type InRepo = (req: Request, repo: RepoContext) => Response | Promise<Response>;

export function routes(
  host: Host,
  defaultRepo: DefaultRepo,
  recent: RecentRepos,
  workspaces: Workspaces,
  listeners: AgentListeners,
) {
  const inRepo =
    (handle: InRepo) =>
    async (req: Request): Promise<Response> => {
      const repo = await requested(req, defaultRepo, workspaces);
      return repo instanceof Response ? repo : handle(req, repo);
    };
  const evidence = EvidenceStore.in(host.dataDir);
  const recorder = playwrightRecorder(host.browser);
  const publicOrigin = (req: Request) =>
    host.publicUrl ?? new URL(req.url).origin;
  const origins = (req: Request) => ({
    reader: publicOrigin(req),
    agent: new URL(req.url).origin,
  });
  return {
    "/*": index,
    ...repoRoutes(host, defaultRepo, recent),
    ...layoutRoutes(LayoutStore.in(host.dataDir)),
    ...evidenceRoutes(evidence),
    "/api/*": () => new Response("Not found", { status: 404 }),
    "/api/log": inRepo(handleLog),
    "/api/operations": inRepo(handleOperations),
    "/api/interdiff": inRepo(handleInterdiff),
    "/api/source": inRepo(handleSource),
    "/api/compare": inRepo(handleCompare),
    "/api/compare/paths": inRepo(handleComparePaths),
    "/api/review": {
      GET: inRepo(reviewRoute(listeners).GET),
      POST: inRepo(reviewRoute(listeners).POST),
    },
    "/api/review/changes": async (
      req: Request,
      server: Bun.Server<SocketData>,
    ) => {
      const repo = await requested(req, defaultRepo, workspaces);
      return repo instanceof Response ? repo : reviewChanges(req, server, repo);
    },
    "/api/local/reviews": { POST: inRepo(localReviewsRoute(host.now).POST) },
    "/api/local/commits": inRepo(handleLocalCommits),
    "/api/local/diff": inRepo(handleLocalDiff),
    "/api/local/size": inRepo(handleLocalSize),
    "/mcp": mcpRoute(
      [
        ...reviewTools(),
        ...componentTools(),
        ...evidenceTools(evidence),
        ...recordingTools(evidence, recorder),
        ...runTools(evidence, recorder),
      ],
      INSTRUCTIONS,
      (req, caller) =>
        agentContext(host, defaultRepo, workspaces, origins(req), caller),
    ),
    [LISTEN_PATH]: agentListen((workspace) => workspaces.context(workspace)),
  };
}
```

`/mcp` is where [agents](agents.md) reach the review document. A tool call
runs in the [workspace its agent named](repos.md#opening-a-workspace), or in
the default repository when it named none. Every link it hands back names
that workspace in `?repo=`, so it [opens in that
repository](../frontend/repos.md#holding-the-tabs-repository) whatever the
reader's other tabs are showing.

```ts
//| id: backend-server

export async function agentContext(
  host: Pick<Host, "now" | "diffy">,
  defaultRepo: Pick<DefaultRepo, "root">,
  workspaces: Pick<Workspaces, "context">,
  origins: { reader: string; agent: string },
  caller: string | null,
): Promise<ToolContext> {
  const named = caller ?? defaultRepo.root;
  if (named === null) {
    throw new ToolError(
      "diffy has no repository open, and the agent named no workspace",
    );
  }
  const repo = await workspaces.context(named).catch((error: Error) => {
    throw new ToolError(error.message);
  });
  const query = `?repo=${encodeURIComponent(repo.root)}`;
  return {
    repo,
    link: (path) => `${origins.reader}${path}${query}`,
    wait: (name) =>
      [...host.diffy, "wait", name, "--url", origins.agent]
        .map(shellWord)
        .join(" "),
    now: host.now,
  };
}

function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}
```

### Route tests

```ts
//| id: backend-server-test
//| file: src/server.test.ts
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
```


```ts
//| id: backend-server-test

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
```

## Quality

### Testing

`bun test` is our test runner. Having fewer deps is nice.

```just
#| id: just-bun-test
# Run tests
@test:
  {{nix_runtime}} bun test
```

### Typechecking

Bun transpiles TS by stripping types, it doesn't check them, so we still
need `tsc --noEmit` (config in `tsconfig.json`) as a separate check.

```just
#| id: just-bun-typecheck
# Typecheck without emitting
@typecheck:
  bunx tsc --noEmit
```

### Linting & formatting

[Biome](https://biomejs.dev/) is our linter/formatter. It's faster and easier than 
ESLint + Prettier. We used the default `bunx biome init`.

```just
#| id: just-biome
# Lint and check formatting/import order
@lint:
  bunx biome check .

# Lint and apply automatic fixes
@lint-fix:
  bunx biome check . --fix

# Format code in place
@format:
  bunx biome format --write .
```
