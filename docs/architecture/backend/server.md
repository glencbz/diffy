# Backend

## Web server

A just rule runs the backend:

```just
#| id: just-bun
# Run the app
@run port="3000":
  {{nix_runtime}} bun run src/cli.ts --port {{port}}

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
import { mcpRoute } from "./backend/agent/mcp";
import { INSTRUCTIONS, reviewTools } from "./backend/agent/review";
import {
  BlobId,
  GitError,
  GitOid,
  gitBlob,
  gitLog,
  gitMaterialize,
  gitMergeBase,
} from "./backend/commit/git";
import {
  GitHubError,
  type GitHubGraphQL,
  ghCliGraphQL,
  githubPullRequestHistory,
  githubPullRequests,
  originRepo,
  type PullRequestHistory,
  type PullRequestState,
  parsePullNumber,
  parseRepoRef,
  pullPins,
  pullStateAt,
} from "./backend/commit/github";
import {
  JjError,
  type JjFileDiff,
  type JjLogEntry,
  jjCommits,
  jjDiff,
  jjDiffBetween,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
import { type AlignedPair, alignSeries } from "./backend/commit/series";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  resolveRegistration,
} from "./backend/review/local";
import type { ReviewStore } from "./backend/review/store";
import { highlightSource } from "./backend/syntax/highlight";
import index from "./frontend/index.html";
import { ReviewCommand } from "./frontend/model/review";

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

export function handleLog(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const atOperation = params.get("op") ?? undefined;
  const revset = params.get("revset") ?? undefined;
  return jjJson(() => jjLog({ revset, atOperation }));
}

export function handleOperations(): Promise<Response> {
  return jjJson(() => jjOpLog({ limit: 200 }));
}

export function handleDiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const revision = params.get("rev") ?? "@";
  const atOperation = params.get("op") ?? undefined;
  return jjJson(async () => ({
    revision,
    files: await jjDiff({ revision, atOperation }),
  }));
}
```

`/api/interdiff` takes `from` and `to` commit ids, each in `jj log` order,
and answers one row per pair [`alignSeries`](series.md) lines up. Commit ids,
because the two sides usually come from different operations. A lone side is
an add or a drop and shows its own diff, which also makes "one `to`, no `from`"
plain single-commit viewing with no separate endpoint.

```ts
//| id: backend-server

export async function handleInterdiff(req: Request): Promise<Response> {
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
    const commits = await jjCommits([...from, ...to]);
    const series = (ids: string[]): JjLogEntry[] =>
      ids.flatMap((id) => {
        const commit = commits.get(id);
        return commit === undefined ? [] : [commit];
      });

    return {
      rows: await Promise.all(
        alignSeries(series(from), series(to)).map(async (pair) => ({
          ...pair,
          files: await pairFiles(pair),
        })),
      ),
    };
  });
}

/** A paired row is an interdiff; a lone commit is just its own diff. */
function pairFiles(pair: AlignedPair<JjLogEntry>): Promise<JjFileDiff[]> {
  if (pair.from !== null && pair.to !== null) {
    return jjInterdiff({ from: pair.from.commitId, to: pair.to.commitId });
  }

  const lone = pair.from ?? pair.to;
  return lone === null
    ? Promise.resolve([])
    : jjDiff({ revision: lone.commitId });
}
```

### Reading a file's source

`/api/source` answers one side of one file, whole and
[highlighted](syntax.md). It takes the blob id off the patch's `index` line,
because an interdiff's before side has no commit id, and reads it from git's
store, so it works the same for local and pull request diffs. The path only
picks the language.

```ts
//| id: backend-server

export async function handleSource(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const blob = BlobId.safeParse(params.get("blob"));
  const path = params.get("path");

  if (!blob.success || path === null || path === "") {
    return Response.json(
      { error: "source needs a blob id and a path" },
      { status: 400 },
    );
  }

  const text = await gitBlob(blob.data);
  if (text === null) {
    return Response.json(
      { error: `no blob ${blob.data} in the object store` },
      { status: 404 },
    );
  }

  return Response.json(await highlightSource(text, path));
}
```

### Reading a pull request from GitHub

A GitHub failure is not always the caller's fault, so `githubJson` sorts
them: `not-found` is a 404; `upstream`, or a `GitError` from a remote that
would not hand over a commit GitHub named, is a 502; a `ZodError` is a 400
naming the bad field.

```ts
//| id: backend-server

/** Run a GitHub-backed handler body, mapping each way it can fail to a status. */
async function githubJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof GitHubError) {
      return Response.json(
        { error: error.message },
        { status: error.kind === "not-found" ? 404 : 502 },
      );
    }
    if (error instanceof GitError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: z.prettifyError(error) }, { status: 400 });
    }
    throw error;
  }
}
```

`/api/github/repo` says which repository to pass, so one build serves any
checkout.

```ts
//| id: backend-server

export function handleGithubRepo(): Promise<Response> {
  return githubJson(async () => {
    const { owner, name } = await originRepo();
    return { repo: `${owner}/${name}` };
  });
}
```

```ts
//| id: backend-server

const PullsQuery = z.object({
  state: z.enum(["open", "closed", "merged", "all"]).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export function handleGithubPulls(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  return githubJson(() => {
    const repo = parseRepoRef(params.get("repo") ?? "");
    const options = PullsQuery.parse({
      state: params.get("state") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return githubPullRequests(repo, options);
  });
}

export function handleGithubPullHistory(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  return githubJson(() =>
    githubPullRequestHistory(
      parseRepoRef(params.get("repo") ?? ""),
      parsePullNumber(params.get("number")),
    ),
  );
}
```

`/api/github/pull/commits` is where the backends meet. The order is a
security property: [`pullStateAt`](github.md#naming-one-state-of-a-pull-request)
resolves the head against the pull request's own chain before anything is
fetched.

```ts
//| id: backend-server

export function handleGithubPullCommits(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  return githubJson(async () => {
    const repo = parseRepoRef(params.get("repo") ?? "");
    const number = parsePullNumber(params.get("number"));
    const head = GitOid.parse(params.get("head"));

    const history = await githubPullRequestHistory(repo, number);
    const state = pullStateAt(history, head);

    const [base, tip] = await gitMaterialize(pullPins(history, state));
    // One witness per oid asked; noUncheckedIndexedAccess cannot know.
    if (base === undefined || tip === undefined) {
      throw new Error("gitMaterialize returned fewer oids than asked");
    }

    return {
      head,
      version: state.version,
      base: history.baseRefOid,
      commits: await gitLog({ from: base, to: tip, limit: 200 }),
    };
  });
}
```

`/api/github/pull/diff` diffs head `to` against `from`, another head or
`base`. Two heads go through [`jjInterdiff`](jj.md#comparing-two-commits),
since the later head is usually the earlier one rebased: on #9, first head
against last, that is three files rather than forty-seven. A head against
`base` is the three-dot diff, [`gitMergeBase`](git.md) then `jjDiffBetween`,
never a diff from `baseRefOid`, which would carry every later base commit in
reverse.

`base` is a tagged parameter rather than an oid the server recognises by
equality with `baseRefOid`. A commit landing on the base between fetching the
history and the diff would break that equality into a 404, and a branch
force-pushed to exactly the base tip would make it switch comparisons under a
reader who picked a version.

`pullDiffResponse` takes the transport as an argument for the tests; a route
handler cannot, since `Bun.serve` passes a second argument of its own.

```ts
//| id: backend-server

export function handleGithubPullDiff(req: Request): Promise<Response> {
  return pullDiffResponse(new URL(req.url).searchParams, ghCliGraphQL);
}

/** `from=base`, or `from=<oid>`. Nothing 40 hex characters long reads as `base`. */
const PullBaselineParam = z.union([
  z.literal("base").transform(() => ({ kind: "base" }) as const),
  GitOid.transform((head) => ({ kind: "version", head }) as const),
]);
type PullBaseline = z.infer<typeof PullBaselineParam>;

/** Exported for tests: the pull request diff route, with its transport given. */
export function pullDiffResponse(
  params: URLSearchParams,
  gh: GitHubGraphQL,
): Promise<Response> {
  return githubJson(async () => {
    const repo = parseRepoRef(params.get("repo") ?? "");
    const number = parsePullNumber(params.get("number"));
    const to = GitOid.parse(params.get("to"));
    const from = PullBaselineParam.parse(params.get("from"));
    const scope = parseDiffScope(params);

    const history = await githubPullRequestHistory(repo, number, gh);
    const toState = pullStateAt(history, to);

    return {
      from,
      to,
      files: await pullDiffFiles(history, toState, from, scope),
    };
  });
}

/**
 * What to diff inside the head a baseline already resolved. `heads` is the
 * whole head, which is what a reader sees before they pick a commit out of
 * it.
 */
type DiffScope =
  | { kind: "heads" }
  | { kind: "commit"; commit: GitOid }
  | { kind: "pair"; from: GitOid; to: GitOid };

/** Either commit alone reduces to that commit's own diff, the same rule
 *  `/api/interdiff` uses when one side of a row is empty. */
function parseDiffScope(params: URLSearchParams): DiffScope {
  const fromCommit = params.get("fromCommit");
  const toCommit = params.get("toCommit");
  if (fromCommit !== null && toCommit !== null) {
    return {
      kind: "pair",
      from: GitOid.parse(fromCommit),
      to: GitOid.parse(toCommit),
    };
  }
  if (toCommit !== null) {
    return { kind: "commit", commit: GitOid.parse(toCommit) };
  }
  if (fromCommit !== null) {
    return { kind: "commit", commit: GitOid.parse(fromCommit) };
  }
  return { kind: "heads" };
}

/** The diff a scope asks for, once materialization already ran. */
function diffForScope(
  scope: DiffScope,
  heads: () => Promise<JjFileDiff[]>,
): Promise<JjFileDiff[]> {
  switch (scope.kind) {
    case "commit":
      return jjDiff({ revision: scope.commit });
    case "pair":
      return jjInterdiff({ from: scope.from, to: scope.to });
    case "heads":
      return heads();
  }
}

/** The diff a baseline asks for, fetching what that comparison needs. */
async function pullDiffFiles(
  history: PullRequestHistory,
  toState: PullRequestState,
  from: PullBaseline,
  scope: DiffScope,
): Promise<JjFileDiff[]> {
  if (from.kind === "version") {
    const fromState = pullStateAt(history, from.head);
    await gitMaterialize(
      [fromState, toState].flatMap((state) => pullPins(history, state)),
    );
    return diffForScope(scope, () =>
      jjInterdiff({ from: fromState.head, to: toState.head }),
    );
  }

  const [base, head] = await gitMaterialize(pullPins(history, toState));
  if (base === undefined || head === undefined) {
    throw new Error("gitMaterialize returned fewer oids than asked");
  }

  return diffForScope(scope, async () =>
    jjDiffBetween({ from: await gitMergeBase(base, head), to: head }),
  );
}
```

### Reading and writing the review document

`/api/review` is the [review store](review-store.md) over HTTP: `GET` reads
the document, `POST` applies one [command](../frontend/review.md#review-state).
A bad body is a 400 naming what is wrong, for writers other than the browser.

```ts
//| id: backend-server

export function reviewRoute(store: ReviewStore) {
  return {
    GET: () => Response.json(store.read()),
    POST: async (req: Request) => {
      const command = ReviewCommand.safeParse(
        await req.json().catch(() => undefined),
      );
      if (!command.success) {
        return Response.json(
          { error: z.prettifyError(command.error) },
          { status: 400 },
        );
      }
      return Response.json(store.apply(command.data));
    },
  };
}
```

`/api/review/changes` is a WebSocket on which every open screen hears
`{ "revision": n }` when the [store](review-store.md#telling-screens-about-changes)
moves. Writes still go through `POST`, so there is one way to write.

```ts
//| id: backend-server

export const REVIEW_TOPIC = "review";

export function reviewChanges(
  req: Request,
  server: Bun.Server<undefined>,
): Response | undefined {
  if (server.upgrade(req)) return undefined;
  return Response.json({ error: "expected a WebSocket" }, { status: 400 });
}

export const reviewSocket: Bun.WebSocketHandler<undefined> = {
  open(ws) {
    ws.subscribe(REVIEW_TOPIC);
  },
  message() {},
};
```

### Local reviews

A `POST` to `/api/local/reviews` registers a [local review](local-reviews.md),
each field left out taking its default, and answers with the name and the
review document it left. An agent declares its work ready this way, and the
commit graph sends the same request with every field filled in, at the
operation the graph is drawn at. `/api/log` takes a `revset` so the graph can
show what a typed one names before it is registered. It is a route rather than a review
command because the server has to evaluate the revset before there is a
version to record. The reads mirror the pull request routes, keyed by commit
ids instead of heads.

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

export function localReviewsRoute(store: ReviewStore) {
  return {
    POST: (req: Request) =>
      localJson(async () => {
        const asked = RegistrationBody.parse(
          await req.json().catch(() => ({})),
        );
        const { name, version } = await resolveRegistration(
          store.read().document,
          asked,
          new Date().toISOString(),
        );
        return {
          name,
          snapshot: store.apply({ kind: "register", name, version }),
        };
      }),
  };
}

export function handleLocalCommits(req: Request): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(() => localCommits(ids));
}

export function handleLocalDiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return localJson(async () => ({
    files: await localDiff(params.get("fromCommit"), params.get("toCommit")),
  }));
}

export function handleLocalSize(req: Request): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(async () => ({ files: await localSize(ids) }));
}
```

Every non-API path serves the page, since the frontend keeps the reader's
place in [the path](../frontend/address.md). An unknown API path is a 404.
`/mcp` is where [agents](agents.md) reach the review document.

```ts
//| id: backend-server

export function routes(store: ReviewStore) {
  return {
    "/*": index,
    "/api/*": () => new Response("Not found", { status: 404 }),
    "/api/log": handleLog,
    "/api/operations": handleOperations,
    "/api/diff": handleDiff,
    "/api/interdiff": handleInterdiff,
    "/api/source": handleSource,
    "/api/github/repo": handleGithubRepo,
    "/api/github/pulls": handleGithubPulls,
    "/api/github/pull/history": handleGithubPullHistory,
    "/api/github/pull/commits": handleGithubPullCommits,
    "/api/github/pull/diff": handleGithubPullDiff,
    "/api/review": reviewRoute(store),
    "/api/review/changes": reviewChanges,
    "/api/local/reviews": localReviewsRoute(store),
    "/api/local/commits": handleLocalCommits,
    "/api/local/diff": handleLocalDiff,
    "/api/local/size": handleLocalSize,
    "/mcp": mcpRoute(
      reviewTools(store),
      INSTRUCTIONS,
      (req) => process.env.DIFFY_PUBLIC_URL ?? new URL(req.url).origin,
    ),
  };
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
import type { GitHubGraphQL } from "./backend/commit/github";
import { jjDiff, jjDiffBetween, jjInterdiff, jjLog } from "./backend/commit/jj";
import { openReviewStore, watchReview } from "./backend/review/store";
import {
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
  reviewSocket,
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

  test("reads only what a revset names", async () => {
    // arrange
    // act
    const res = await handleLog(new Request("http://test/api/log?revset=@"));
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
```


The GitHub routes are tested only for what they refuse, which pins that
parsing happens before any API call.

```ts
//| id: backend-server-test

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
```

```ts
//| id: backend-server-test

describe("the review route", () => {
  async function withStore(
    run: (route: ReturnType<typeof reviewRoute>) => Promise<void>,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "diffy-route-"));
    try {
      await run(reviewRoute(openReviewStore(join(dir, "r.sqlite"))));
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
    const route = localReviewsRoute(store);
    const post = (body: unknown) =>
      route.POST(
        new Request("http://test/api/local/reviews", {
          method: "POST",
          body: JSON.stringify(body),
        }),
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
      websocket: reviewSocket,
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

The diff route runs against a stubbed pull request built from commits already
in this repository, so nothing is fetched. Each answer is checked against the
jj call it should have made, since a file count would pass with the two
diffs swapped. `divergedPull` finds a trunk merge whose base side holds a
commit the merge base lacks, the only shape where diffing from the merge base
and from the base tip differ. It asks a revset rather than diffing, since
diffing the review chain's merges runs past the test timeout.

```ts
//| id: backend-server-test

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
```
