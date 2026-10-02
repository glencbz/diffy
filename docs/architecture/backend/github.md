# GitHub commit backend

A pull request's force pushes are its review axis, the "before and after" the
[jj backend](jj.md) gets from the operation log. This module fetches that
sequence and nothing else: **no type it exports carries a commit message, an
author or a patch.** GitHub says which heads a pull request has had; the
[local git object store](git.md) says what they contain. The rate-limited,
stale-prone source shrinks to a list of object ids.

GraphQL is the only API that can answer: REST's timeline reports a force push
with only the new head, so the head a pull request was opened with is lost.
`HeadRefForcePushedEvent` carries both `beforeCommit` and `afterCommit`. The
whole transport is one function type, so tests stub it with no network.

```ts
//| id: github-module
//| file: src/backend/commit/github.ts
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
```

The transport is `gh api graphql`, which holds the token and reads `GH_HOST`
itself, so the same code runs against github.com and a proxied host.
`NOT_FOUND` is a 404 to the caller; every other failure is a 502.

```ts
//| id: github-module

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

/** `gh` writes GraphQL errors to stdout (the JSON body, `errors` and all) and
 *  exits non-zero; stderr holds only a one-line summary. */
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
```

### Naming a pull request

Repository and pull request number arrive as query parameters and are parsed
at the boundary, so a junk one is a 400 rather than a GraphQL 502.

```ts
//| id: github-module

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
```

### Which repository

The repository is whatever `origin` names, because [git](git.md) fetches
every pull request's commits from `origin`. The URL's host is ignored, so a
clone through the exe.dev proxy names the same `owner/name` a github.com clone
does; `GH_HOST` decides which host `gh` asks.

```ts
//| id: github-module

/** The `owner/name` a git remote URL ends in, or null. */
export function parseRemoteUrl(url: string): RepoRef | null {
  const path = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, "")
    .replace(/^[^/:]+:/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const match = /(?:^|\/)([^/\s]+)\/([^/\s]+)$/.exec(path);
  if (match === null) return null;
  return RepoRef.parse({ owner: match[1], name: match[2] });
}

/** The repository the working directory's `origin` remote names. */
export async function originRepo(): Promise<RepoRef> {
  const got = await $`git remote get-url origin`.quiet().nothrow();
  const url = got.stdout.toString().trim();
  const repo = got.exitCode === 0 ? parseRemoteUrl(url) : null;
  if (repo === null) {
    throw new GitHubError(
      got.exitCode === 0
        ? `origin ${url} does not name an owner/name repository`
        : "this repository has no origin remote",
      "not-found",
    );
  }
  return repo;
}
```

### Listing pull requests

```ts
//| id: github-module

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

// `states` is a list of enums, spliced in rather than passed as a variable
// so the transport seam carries only strings and numbers. Values come from
// the closed PULL_STATES map, so no caller text reaches the document.
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
  // 100 is the largest page GraphQL returns; past it, ask by number.
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
```

### A pull request's history

Force-push events come back oldest first, each `beforeCommit` the previous
`afterCommit`, so they form a chain of heads. The chain is one longer than the
events: `events[0].beforeCommit` is the head the pull request was opened with.
A fast-forward push records no event, so `headRefOid` is appended when the
chain's end disagrees with it. `truncated` marks a hole in the middle: more
than a hundred force pushes, or an event whose commits GitHub has collected.

```ts
//| id: github-module

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
```

```ts
//| id: github-module

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
```

```ts
//| id: github-module

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

  // GraphQL's other "no such thing": a 200 with a null in it.
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
```

### Naming one state of a pull request

A state is named by its head, never its version: `version` is a position
counted after collapsing, so any state leaving the chain (collected, paged
out) renumbers the rest, and a bookmarked "v7" would silently become another
commit. Versions are display labels only.

`pullStateAt` is also the security check. `gitMaterialize` fetches any object
id it is given from `origin`, so resolving a head against the pull request's
own chain first means only ids GitHub published as its heads are ever fetched.

```ts
//| id: github-module

/** The state this pull request was in at `head`. Throws if it never had one. */
export function pullStateAt(
  history: PullRequestHistory,
  head: GitOid,
): PullRequestState {
  const state = history.states.find((candidate) => candidate.head === head);
  if (state === undefined) {
    throw new GitHubError(
      `#${history.number} never had head ${head}`,
      "not-found",
    );
  }

  return state;
}
```

#### Test

Every case stubs the transport with a captured envelope. The chain below is
pull request #9 of this repository, six force pushes deep.

```ts
//| id: github-module-test
//| file: src/backend/commit/github.test.ts
import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { GitOid } from "./git";
import {
  type ForcePushEvent,
  GitHubError,
  type GitHubGraphQL,
  githubPullRequestHistory,
  githubPullRequests,
  headChain,
  PullNumber,
  type PullRequestHistory,
  parsePullNumber,
  parseRemoteUrl,
  parseRepoRef,
  pullStateAt,
} from "./github";

/** The heads pull request #9 of this repo has had, oldest first. */
const CHAIN = [
  "bb968350e9b427d7081a4cd8d7699a4936af8aaa",
  "84368e28591b12827c1ef6d9ebce1c225ac51868",
  "232e5944d8ecaee9c9c730b58fc0c1a51b4bf962",
  "48aed1fce0d2ea0640a379e0a05509a688ed3c89",
  "15defada34973f61ac514fda1dfe326daeb530f2",
  "96c03b8a3c3066ea66b34fd59876275d8710046e",
  "6f24fa3fd3438f5ebe25018b5d6ba471bf119b45",
].map((oid) => GitOid.parse(oid));

const BASE = GitOid.parse("e28c33e61b920728d79d099a9963ff23a865ef98");

function oid(seed: string): GitOid {
  return GitOid.parse(seed.repeat(40).slice(0, 40));
}

/** Consecutive heads, as the timeline would report the pushes between them. */
function chainEvents(heads: GitOid[]): ForcePushEvent[] {
  return heads.slice(1).map((after, index) => ({
    at: `2026-09-0${index + 1}T10:00:00Z`,
    before: heads[index] as GitOid,
    after,
  }));
}

describe("headChain", () => {
  test("a PR with no force pushes has one state, where it opened", () => {
    // arrange
    // act
    const states = headChain([], oid("a"));

    // assert
    expect(states).toEqual([
      { version: 1, head: oid("a"), origin: { kind: "opened" } },
    ]);
  });

  test("one force push yields the opening head and the new one", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states).toEqual([
      { version: 1, head: oid("a"), origin: { kind: "opened" } },
      {
        version: 2,
        head: oid("b"),
        origin: { kind: "force-pushed", at: events[0]?.at ?? "" },
      },
    ]);
  });

  test("a linked chain of pushes keeps every head in order", () => {
    // arrange
    const heads = [oid("a"), oid("b"), oid("c"), oid("d")];

    // act
    const states = headChain(chainEvents(heads), oid("d"));

    // assert
    expect(states.map((state) => state.head)).toEqual(heads);
    expect(states.map((state) => state.version)).toEqual([1, 2, 3, 4]);
    expect(states[0]?.origin).toEqual({ kind: "opened" });
    for (const state of states.slice(1)) {
      expect(state.origin.kind).toBe("force-pushed");
    }
  });

  test("appends the tip when no event names it, as a fast-forward push", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("c"));

    // assert
    expect(states.map((state) => state.head)).toEqual([
      oid("a"),
      oid("b"),
      oid("c"),
    ]);
    expect(states.at(-1)?.origin).toEqual({ kind: "current" });
  });

  test("collapses a push that left the head where it was", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states.map((state) => state.head)).toEqual([oid("a"), oid("b")]);
  });

  test("numbers states after collapsing, so versions have no gaps", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("a"), oid("b"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states.map((state) => state.version)).toEqual([1, 2]);
  });
});
```

```ts
//| id: github-module-test

const REPO = { owner: "glencbz", name: "diffy" };

/** A transport that answers every query with one captured envelope. */
function stub(envelope: unknown): GitHubGraphQL {
  return () => Promise.resolve(envelope);
}

function historyEnvelope(
  nodes: unknown[],
  hasNextPage = false,
  head: GitOid = CHAIN.at(-1) as GitOid,
): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          number: 9,
          headRefOid: head,
          baseRefName: "main",
          baseRefOid: BASE,
          timelineItems: { pageInfo: { hasNextPage }, nodes },
        },
      },
    },
  };
}

/** The six force pushes of pull request #9, as GraphQL returns them. */
const PULL_9_NODES = CHAIN.slice(1).map((after, index) => ({
  createdAt: `2026-09-0${index + 1}T10:00:00Z`,
  beforeCommit: { oid: CHAIN[index] },
  afterCommit: { oid: after },
}));

describe("githubPullRequestHistory", () => {
  test("turns a real timeline into the chain of heads", async () => {
    // arrange
    const gh = stub(historyEnvelope(PULL_9_NODES));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.states).toHaveLength(7);
    expect(history.states.map((state) => state.head)).toEqual(CHAIN);
    expect(history.states[0]?.origin).toEqual({ kind: "opened" });
    expect(history.states.at(-1)?.head).toBe(CHAIN.at(-1) as GitOid);
    expect(history.baseRefOid).toBe(BASE);
    expect(history.baseRefName).toBe("main");
    expect(history.truncated).toBe(false);
  });

  test("reports a full page of force pushes as truncated", async () => {
    // arrange
    const gh = stub(historyEnvelope(PULL_9_NODES, true));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.truncated).toBe(true);
  });

  test("drops an event GitHub has collected, and says so", async () => {
    // arrange
    const nodes = [
      ...PULL_9_NODES,
      {
        createdAt: "2026-09-09T10:00:00Z",
        beforeCommit: null,
        afterCommit: { oid: CHAIN.at(-1) },
      },
    ];
    const gh = stub(historyEnvelope(nodes));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.states.map((state) => state.head)).toEqual(CHAIN);
    expect(history.truncated).toBe(true);
  });

  test("reports a null pullRequest as not-found", async () => {
    // arrange
    const gh = stub({ data: { repository: { pullRequest: null } } });

    // act
    const attempt = githubPullRequestHistory(REPO, PullNumber.parse(99999), gh);

    // assert
    await expect(attempt).rejects.toMatchObject({
      name: "GitHubError",
      kind: "not-found",
    });
  });
});

describe("githubPullRequests", () => {
  const NODES = [
    {
      number: 13,
      title: "jj: interdiff two commits, and two commit series",
      state: "MERGED",
      author: { login: "glencbz" },
      updatedAt: "2026-09-12T09:00:00Z",
      headRefOid: CHAIN[2],
      baseRefName: "main",
      url: "https://github.com/glencbz/diffy/pull/13",
    },
    {
      number: 9,
      title: "frontend: give the graph side-by-side branch lanes",
      state: "OPEN",
      author: null,
      updatedAt: "2026-09-10T09:00:00Z",
      headRefOid: CHAIN.at(-1),
      baseRefName: "main",
      url: "https://github.com/glencbz/diffy/pull/9",
    },
  ];

  test("reads the list in the order GitHub returned it", async () => {
    // arrange
    const gh = stub({
      data: { repository: { pullRequests: { nodes: NODES } } },
    });

    // act
    const pulls = await githubPullRequests(REPO, { state: "all" }, gh);

    // assert
    expect(pulls.map((pull) => pull.number) as number[]).toEqual([13, 9]);
    expect(pulls[0]?.state).toBe("MERGED");
    expect(pulls[0]?.headRefOid).toBe(CHAIN[2] as GitOid);
  });

  test("reads a deleted author as an empty login", async () => {
    // arrange
    const gh = stub({
      data: { repository: { pullRequests: { nodes: NODES } } },
    });

    // act
    const pulls = await githubPullRequests(REPO, {}, gh);

    // assert
    expect(pulls[1]?.author).toBe("");
  });

  test("reports a null repository as not-found", async () => {
    // arrange
    const gh = stub({ data: { repository: null } });

    // act
    const attempt = githubPullRequests(REPO, {}, gh);

    // assert
    await expect(attempt).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("parseRepoRef", () => {
  test("splits an owner/name slug", () => {
    // arrange
    // act
    // assert
    expect(parseRepoRef("glencbz/diffy")).toEqual({
      owner: "glencbz",
      name: "diffy",
    });
  });

  test.each(["", "diffy", "glencbz/", "/diffy", "a/b/c", "glen cbz/diffy"])(
    "refuses %p",
    (raw) => {
      // arrange
      // act
      // assert
      expect(() => parseRepoRef(raw)).toThrow(z.ZodError);
    },
  );
});

describe("parseRemoteUrl", () => {
  test.each([
    "https://github.com/glencbz/diffy.git",
    "https://github.int.exe.xyz/glencbz/diffy.git",
    "https://github.com/glencbz/diffy",
    "https://github.com/glencbz/diffy/",
    "ssh://git@github.com/glencbz/diffy.git",
    "git@github.com:glencbz/diffy.git",
  ])("reads glencbz/diffy out of %p", (url) => {
    // arrange
    // act
    // assert
    expect(parseRemoteUrl(url)).toEqual({ owner: "glencbz", name: "diffy" });
  });

  test.each(["", "diffy", "https://github.com/diffy"])("refuses %p", (url) => {
    // arrange
    // act
    // assert
    expect(parseRemoteUrl(url)).toBeNull();
  });
});

describe("parsePullNumber", () => {
  test("reads a positive integer", () => {
    // arrange
    // act
    // assert
    expect(parsePullNumber("9")).toBe(PullNumber.parse(9));
  });

  test.each([null, "", "0", "-1", "1.5", "nine", "9; drop"])(
    "refuses %p",
    (raw) => {
      // arrange
      // act
      // assert
      expect(() => parsePullNumber(raw)).toThrow(z.ZodError);
    },
  );
});
```

The last case refuses a real object id that is not one of this pull
request's heads. The base tip arrives in that shape too, which is why
[the diff route](server.md) asks for the base by name rather than by oid.

```ts
//| id: github-module-test

/** The error a call threw, so an assertion can look past its message. */
function catchError(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("pullStateAt", () => {
  const history: PullRequestHistory = {
    number: PullNumber.parse(9),
    baseRefName: "main",
    baseRefOid: BASE,
    states: headChain(chainEvents(CHAIN), CHAIN.at(-1) as GitOid),
    truncated: false,
  };

  test("finds the head the pull request opened with", () => {
    // arrange
    // act
    const state = pullStateAt(history, CHAIN[0] as GitOid);

    // assert
    expect(state).toEqual({
      version: 1,
      head: CHAIN[0] as GitOid,
      origin: { kind: "opened" },
    });
  });

  test("finds a head a force push produced", () => {
    // arrange
    // act
    const state = pullStateAt(history, CHAIN[4] as GitOid);

    // assert
    expect(state.version).toBe(5);
    expect(state.head).toBe(CHAIN[4] as GitOid);
    expect(state.origin.kind).toBe("force-pushed");
  });

  test("refuses a head the pull request never had", () => {
    // arrange
    const stranger = oid("f");

    // act
    const error = catchError(() => pullStateAt(history, stranger));

    // assert
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ kind: "not-found" });
    expect((error as Error).message).toContain(stranger);
  });
});
```
