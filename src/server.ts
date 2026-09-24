// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import * as z from "zod";
import {
  GitError,
  GitOid,
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
import index from "./frontend/index.html";

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
  const atOperation = new URL(req.url).searchParams.get("op") ?? undefined;
  return jjJson(() => jjLog({ atOperation }));
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
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[3]

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
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[4]

export function handleGithubPullCommits(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  return githubJson(async () => {
    const repo = parseRepoRef(params.get("repo") ?? "");
    const number = parsePullNumber(params.get("number"));
    const head = GitOid.parse(params.get("head"));

    const history = await githubPullRequestHistory(repo, number);
    const state = pullStateAt(history, head);

    const [base, tip] = await gitMaterialize(pullPins(history, state));
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
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[5]

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
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[6]

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/operations": handleOperations,
  "/api/diff": handleDiff,
  "/api/interdiff": handleInterdiff,
  "/api/github/pulls": handleGithubPulls,
  "/api/github/pull/history": handleGithubPullHistory,
  "/api/github/pull/commits": handleGithubPullCommits,
  "/api/github/pull/diff": handleGithubPullDiff,
};

if (import.meta.main) {
  const server = Bun.serve({ routes });
  console.log(`Listening on ${server.url}`);
}
// ~/~ end
