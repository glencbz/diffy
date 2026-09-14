// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[init]
import { $ } from "bun";
import * as z from "zod";
import { GitOid, type GitPin, RefPath } from "./git";

/** Runs one GraphQL query and returns the raw envelope. The entire transport seam. */
export type GitHubGraphQL = (
  query: string,
  variables: Record<string, string | number>,
) => Promise<unknown>;

/** GitHub answered and the answer was no, or GitHub could not be reached. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "upstream",
  ) {
    super(message);
    this.name = "GitHubError";
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[1]

const GraphQLErrors = z.object({
  errors: z
    .array(z.object({ type: z.string().optional(), message: z.string() }))
    .min(1),
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** `gh` writes GraphQL errors to stdout and still exits non-zero. */
function ghFailure(error: InstanceType<typeof $.ShellError>): GitHubError {
  const body = GraphQLErrors.safeParse(parseJson(error.stdout.toString()));
  const [first] = body.success ? body.data.errors : [];

  if (first !== undefined) {
    return new GitHubError(
      first.message,
      first.type === "NOT_FOUND" ? "not-found" : "upstream",
    );
  }

  return new GitHubError(
    error.stderr.toString().trim() || `gh exited ${error.exitCode}`,
    "upstream",
  );
}

/** The default transport: `gh api graphql`, with `gh` supplying host and token. */
export const ghCliGraphQL: GitHubGraphQL = async (query, variables) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-F", `${name}=${value}`);
  }

  try {
    return JSON.parse(await $`gh ${args}`.quiet().text());
  } catch (error) {
    if (error instanceof $.ShellError) throw ghFailure(error);
    throw error;
  }
};
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[2]

export const RepoRef = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRef>;

export const PullNumber = z.number().int().positive().brand("PullNumber");
export type PullNumber = z.infer<typeof PullNumber>;

export const PullState = z.enum(["OPEN", "CLOSED", "MERGED"]);

const RepoSlug = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, "expected a repository as owner/name");

/** Parse an `owner/name` slug. Throws a ZodError, which the server reports as 400. */
export function parseRepoRef(raw: string): RepoRef {
  const [owner, name] = RepoSlug.parse(raw).split("/");
  return RepoRef.parse({ owner, name });
}

/** Parse a pull request number, including a missing one. Throws a ZodError. */
export function parsePullNumber(raw: string | null): PullNumber {
  return PullNumber.parse(raw === null ? Number.NaN : Number(raw));
}

/** Everything fetched to show one pull request lives under this path. */
export function pullRefPath(number: PullNumber): RefPath {
  return RefPath.parse(`pull/${number}`);
}

/**
 * Where to pin the base and one state of a pull request. The state is named by
 * its version because these refs get read and pruned by people.
 */
export function pullPins(
  history: PullRequestHistory,
  state: PullRequestState,
): GitPin[] {
  const root = pullRefPath(history.number);
  return [
    { at: RefPath.parse(`${root}/base`), oid: history.baseRefOid },
    { at: RefPath.parse(`${root}/v${state.version}`), oid: state.head },
  ];
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[3]

export interface PullRequestSummary {
  number: PullNumber;
  title: string;
  state: z.infer<typeof PullState>;
  /** Login, or "" for a deleted/ghost account. */
  author: string;
  updatedAt: string;
  headRefOid: GitOid;
  baseRefName: string;
  url: string;
}

const PULL_STATES = {
  open: "[OPEN]",
  closed: "[CLOSED]",
  merged: "[MERGED]",
  all: "[OPEN, CLOSED, MERGED]",
} as const;

export interface PullRequestsOptions {
  state?: keyof typeof PULL_STATES;
  limit?: number;
}

const PullRequestsWire = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequests: z.object({
          nodes: z.array(
            z.object({
              number: PullNumber,
              title: z.string(),
              state: PullState,
              author: z.object({ login: z.string() }).nullable(),
              updatedAt: z.string(),
              headRefOid: GitOid,
              baseRefName: z.string(),
              url: z.string(),
            }),
          ),
        }),
      })
      .nullable(),
  }),
});

function pullRequestsQuery(states: string): string {
  return `query($owner:String!, $name:String!, $limit:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequests(first:$limit, states:${states}, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes { number title state author { login } updatedAt headRefOid baseRefName url }
    }
  }
}`;
}

/** A repository's pull requests, most recently updated first. */
export async function githubPullRequests(
  repo: RepoRef,
  options: PullRequestsOptions = {},
  gh: GitHubGraphQL = ghCliGraphQL,
): Promise<PullRequestSummary[]> {
  const query = pullRequestsQuery(PULL_STATES[options.state ?? "open"]);
  const limit = Math.min(options.limit ?? 50, 100);
  const wire = PullRequestsWire.parse(
    await gh(query, { owner: repo.owner, name: repo.name, limit }),
  );

  const repository = wire.data.repository;
  if (repository === null) {
    throw new GitHubError(
      `no repository ${repo.owner}/${repo.name}`,
      "not-found",
    );
  }

  return repository.pullRequests.nodes.map((node) => ({
    number: node.number,
    title: node.title,
    state: node.state,
    author: node.author?.login ?? "",
    updatedAt: node.updatedAt,
    headRefOid: node.headRefOid,
    baseRefName: node.baseRefName,
    url: node.url,
  }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[4]

/**
 * How a head became the PR's head. A tagged union rather than a nullable
 * timestamp: "the PR opened here" and "this is the tip but no event names it"
 * are different facts that both lack a force-push time.
 */
export type PullHeadOrigin =
  | { kind: "opened" }
  | { kind: "force-pushed"; at: string }
  | { kind: "current" };

/** One point in a PR's life: what its head was, and how it got there. */
export interface PullRequestState {
  /** 1-based position in the chain. Diffy's count, not an identifier GitHub issues. */
  version: number;
  head: GitOid;
  origin: PullHeadOrigin;
}

export interface PullRequestHistory {
  number: PullNumber;
  baseRefName: string;
  /** The base branch tip *now*. Historical bases are not recoverable from the API. */
  baseRefOid: GitOid;
  /** Oldest first. First is {kind:"opened"}; last always equals headRefOid. */
  states: PullRequestState[];
  /** True when force pushes overflowed one page, so middle states are missing. */
  truncated: boolean;
}

/** A force push, as the GraphQL timeline reports it. Input to `headChain`. */
export interface ForcePushEvent {
  at: string;
  before: GitOid;
  after: GitOid;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[5]

type Unnumbered = Omit<PullRequestState, "version">;

/** The heads a PR has had, oldest first, from its force pushes and its tip. */
export function headChain(
  events: ForcePushEvent[],
  headRefOid: GitOid,
): PullRequestState[] {
  const [opening] = events;
  const chain: Unnumbered[] =
    opening === undefined
      ? [{ head: headRefOid, origin: { kind: "opened" } }]
      : [
          { head: opening.before, origin: { kind: "opened" } },
          ...events.map(
            (event): Unnumbered => ({
              head: event.after,
              origin: { kind: "force-pushed", at: event.at },
            }),
          ),
        ];

  if (chain.at(-1)?.head !== headRefOid) {
    chain.push({ head: headRefOid, origin: { kind: "current" } });
  }

  // Numbering comes after collapsing, so the versions have no gaps.
  return chain
    .filter(
      (state, index) => index === 0 || state.head !== chain[index - 1]?.head,
    )
    .map((state, index) => ({ version: index + 1, ...state }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module>>[6]

const PullRequestHistoryWire = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            number: PullNumber,
            headRefOid: GitOid,
            baseRefName: z.string(),
            baseRefOid: GitOid,
            timelineItems: z.object({
              pageInfo: z.object({ hasNextPage: z.boolean() }),
              nodes: z.array(
                z.object({
                  createdAt: z.string(),
                  beforeCommit: z.object({ oid: GitOid }).nullable(),
                  afterCommit: z.object({ oid: GitOid }).nullable(),
                }),
              ),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

const HISTORY_QUERY = `query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      number headRefOid baseRefName baseRefOid
      timelineItems(first:100, itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]) {
        pageInfo { hasNextPage }
        nodes { ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } } }
      }
    }
  }
}`;

/** Every head a pull request has had, oldest first. */
export async function githubPullRequestHistory(
  repo: RepoRef,
  number: PullNumber,
  gh: GitHubGraphQL = ghCliGraphQL,
): Promise<PullRequestHistory> {
  const wire = PullRequestHistoryWire.parse(
    await gh(HISTORY_QUERY, {
      owner: repo.owner,
      name: repo.name,
      number,
    }),
  );

  const pull = wire.data.repository?.pullRequest ?? null;
  if (pull === null) {
    throw new GitHubError(
      `no pull request ${repo.owner}/${repo.name}#${number}`,
      "not-found",
    );
  }

  const events: ForcePushEvent[] = [];
  let collected = false;
  for (const node of pull.timelineItems.nodes) {
    if (node.beforeCommit === null || node.afterCommit === null) {
      collected = true;
      continue;
    }
    events.push({
      at: node.createdAt,
      before: node.beforeCommit.oid,
      after: node.afterCommit.oid,
    });
  }

  return {
    number: pull.number,
    baseRefName: pull.baseRefName,
    baseRefOid: pull.baseRefOid,
    states: headChain(events, pull.headRefOid),
    truncated: collected || pull.timelineItems.pageInfo.hasNextPage,
  };
}
// ~/~ end
