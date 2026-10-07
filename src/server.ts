// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import * as z from "zod";
import { mcpRoute } from "./backend/agent/mcp";
import { INSTRUCTIONS, reviewTools } from "./backend/agent/review";
import {
  beforePaths,
  CompareError,
  compareFiles,
} from "./backend/commit/compare";
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[1]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[2]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[3]

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

export function handleCompare(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => {
    const oldPath = z.string().min(1).parse(params.get("oldPath"));
    const newPath = z.string().min(1).parse(params.get("newPath"));
    return {
      file: await compareFiles(compareSides(params), oldPath, newPath),
    };
  });
}

export function handleComparePaths(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => ({
    paths: await beforePaths(compareSides(params)),
  }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[4]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[5]

export function handleGithubRepo(): Promise<Response> {
  return githubJson(async () => {
    const { owner, name } = await originRepo();
    return { repo: `${owner}/${name}` };
  });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[6]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[7]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[8]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[9]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[10]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[11]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[12]

export function routes(store: ReviewStore) {
  return {
    "/*": index,
    "/api/*": () => new Response("Not found", { status: 404 }),
    "/api/log": handleLog,
    "/api/operations": handleOperations,
    "/api/diff": handleDiff,
    "/api/interdiff": handleInterdiff,
    "/api/source": handleSource,
    "/api/compare": handleCompare,
    "/api/compare/paths": handleComparePaths,
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
// ~/~ end
