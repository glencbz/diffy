# GitHub commit backend

A pull request is a branch that gets rewritten. Every force push replaces its
head with a new commit, and the version a reviewer read yesterday is no longer
reachable from anything. GitHub remembers the sequence anyway, and that
sequence is the review axis we want: the same "before and after" the
[jj backend](jj.md) gets from the operation log, for a repository nobody has
locally.

This module fetches that sequence and nothing else. **No type it exports
carries a commit message, an author or a patch.** GitHub is a metadata oracle
here, authoritative for which pull requests exist and which object ids their
heads have been, and the [local git object store](git.md) is authoritative for
what any of those commits actually contain. Splitting it that way keeps the
expensive, rate-limited, eventually-stale source down to a list of 40-character
strings, and lets the free, exact, local one answer every question about
content. It also means the API never has to be asked twice for the same commit.

There is no shared `CommitBackend` interface. Two implementations is not enough
to find the abstraction, and one guessed now would only shape this backend to
fit jj.

## Functionality

### Talking to GitHub

GraphQL is the only endpoint that answers the question. REST's timeline reports
a force push with a single `commit_id`, the commit that became the head, and
the commit that stopped being the head is not in the payload, so the head the
pull request was opened with cannot be recovered from REST at all. GraphQL's
`HeadRefForcePushedEvent` carries both `beforeCommit` and `afterCommit`.

The entire transport is one function type. Everything else in this module is a
query string, a Zod schema and pure list handling, so injecting a stub at this
seam makes the rest of the module testable without a network, a token or a
fixture server.

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

The transport we have today is the `gh` CLI, which already holds the token and
already knows which host to talk to. `GH_HOST` is read from the environment by
`gh` itself, so it is never named here: the same code runs against
github.com and against a proxied host, and choosing between them is the
operator's job, not the module's.

`gh api graphql` has one habit worth knowing. A GraphQL error is an HTTP 200
with an `errors` array in the body, but `gh` exits 1 for it, and it writes the
full JSON body, `errors` and all, to **stdout**. Bun's `$` throws for the
non-zero exit, so the useful diagnosis is sitting in `error.stdout` while
`error.stderr` holds only a one-line summary. A `NOT_FOUND` error, which is
what a mistyped repository or a pull request number that was never used looks
like, is a 404 to our caller; everything else is an upstream fault and a 502.
Output that will not parse as JSON means `gh` failed before it got an answer,
which is also upstream.

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
```

### Naming a pull request

A repository is an owner and a name, a pull request is a positive integer, and
both arrive as URL query parameters written by somebody else. They are branded
and parsed at the boundary, so a junk parameter fails as a `ZodError` the
[server](server.md) turns into a 400, which is the caller's fault, rather than
as a GraphQL error it would have to turn into a 502, which is not. The rest of
the module handles values that have already been checked.

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

### Listing pull requests

The list is a picker's data source, so it is ordered the way a picker wants it,
most recently updated first, and capped. Fifty is the default and a hundred is
the ceiling, which is also the largest page GraphQL will return in one request;
asking for more would mean pagination, and a review tool that needs the
hundred-and-first least recently touched pull request can ask for it by number.

The state filter is spliced into the query document rather than passed as a
variable. `states` is a `[PullRequestState!]`, a list of enums, and the
transport seam deliberately carries only strings and numbers so that a stub can
implement it in one line. The spliced values come from a closed map keyed by a
closed union, so no caller text reaches the document.

`author` is nullable: a login that has been deleted leaves the pull request
behind with no author at all. That becomes `""` rather than `null`, so every
consumer gets a string.

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
```

### A pull request's history

Every force push is one step in the pull request's life, and the timeline
records both ends of it. The events come back oldest first, and each event's
`beforeCommit` is the previous event's `afterCommit`, so the events form a
chain rather than a set: the heads the branch has had, in order.

The chain is one longer than the list of events. `events[0].beforeCommit` is
the head the pull request was **opened** with, which is the state no force push
produced and the one REST cannot report. Every subsequent head is the `after`
side of the push that created it.

A fast-forward push emits no event at all. It adds commits without rewriting
any, so GitHub has nothing to record, but the head still moved. That shows up
as a chain whose last entry disagrees with `headRefOid`, and appending
`headRefOid` fixes it. The appended state gets its own origin, `current`,
rather than a force push's timestamp it does not have. A three-way tagged union
says exactly that: "the pull request opened here", "a force push at 14:02 put
it here", and "this is the tip and no event named it" are three different
facts, and only two of them have a time. A nullable timestamp would have
flattened the first and third into the same thing.

`truncated` says the middle of the chain is missing, and there are two ways for
that to happen: more than a hundred force pushes, reported by
`pageInfo.hasNextPage`, or an event whose commits GitHub has since garbage
collected, which comes back with a null `beforeCommit` or `afterCommit`. Either
way the states either side of the hole are no longer adjacent, so the flag
travels with the data instead of the hole passing for a complete history.

`timelineItems.totalCount` counts every kind of timeline item, comments and
labels included, not the ones the `itemTypes` filter selected, so it is neither
the number of force pushes nor a truncation signal. Nothing here reads it.

`baseRefOid` is the base branch's tip **now**. GitHub does not record what the
base was at any earlier moment, so an old head against today's base is the
closest thing to a historical range the API supports.

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

`headChain` is pure and total, and it holds the whole rule about what a pull
request's history is, so it can be tested against events written by hand rather
than only against whatever the API returned. An empty chain is a pull request
that was opened and left alone, which is most of them.

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

The query asks for the force pushes and for the three fields that place them:
the current head, the base branch and its tip.

```graphql
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      number headRefOid baseRefName baseRefOid
      timelineItems(first:100, itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]) {
        pageInfo { hasNextPage }
        nodes { ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } } }
      }
    }
  }
}
```

A null `repository` or `pullRequest` is a 200 with a hole in it, which is how
GraphQL reports "no such thing" when the token can see the repository but the
number is unused. It means the same as a `NOT_FOUND` error and is reported the
same way.

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

#### Test

These tests make no network call. The transport is a parameter, so every case
injects a stub that returns a captured envelope, and the assertions are about
our handling of it. The payloads are the real shapes: the chain below is pull
request #9 of this repository, six force pushes deep.

`headChain` gets the exhaustive treatment because it is where the rule lives,
including the two cases no live query would reliably produce on demand, a tip
that no event names and a push that changed nothing.

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
  parsePullNumber,
  parseRepoRef,
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

The stubbed-transport tests check the two things a stub can check: that a real
envelope becomes the right values, and that the shapes GitHub uses for "not
here" all arrive as a `GitHubError` the server can turn into a 404.

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

  test("a PR with no force pushes has one state", async () => {
    // arrange
    const gh = stub(historyEnvelope([], false, CHAIN[0] as GitOid));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(11),
      gh,
    );

    // assert
    expect(history.states).toEqual([
      { version: 1, head: CHAIN[0] as GitOid, origin: { kind: "opened" } },
    ]);
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

  test("passes a transport's not-found through untouched", async () => {
    // arrange
    const gh: GitHubGraphQL = () =>
      Promise.reject(
        new GitHubError("Could not resolve to a Repository", "not-found"),
      );

    // act
    const attempt = githubPullRequestHistory(REPO, PullNumber.parse(9), gh);

    // assert
    await expect(attempt).rejects.toBeInstanceOf(GitHubError);
    await expect(attempt).rejects.toMatchObject({ kind: "not-found" });
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
