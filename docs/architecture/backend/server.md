# Backend

## Web server

A just rule runs the backend:

```just
#| id: just-bun
# Run the app
@run port="3000":
  PORT={{port}} bun run src/server.ts

```

The entrypoint is a single ts file with a web server. Route handlers and the
route table are exported so tests can call them directly; `Bun.serve` only runs
when the file is the process entrypoint (`import.meta.main`).

`Bun.serve` is given no port, which makes it read `$PORT` and fall back to 3000.
Every workspace serves the repo it sits in, so several of them run side by side
during review, each on a port of its own.

`just run` leaves `NODE_ENV` alone, so Bun serves in dev mode with hot reload,
which is what a frontend change wants locally. Dev mode also checks the `Host`
header against the address it is listening on, so it cannot be read through a
proxy; serving a workspace for review therefore sets `NODE_ENV=production`. Both
modes are worth having, so the choice sits with whoever starts the server rather
than being fixed here. See [serving](../../devtools/serving.md).

`jjJson` runs a handler body and turns a rejected revset or operation id
(`JjError`) into a 400 carrying jj's own message; anything else is a genuine
fault and propagates as a 500. Every jj-backed route goes through it, so that
mapping exists in one place instead of being repeated per handler.

```ts
//| id: backend-server
//| file: src/server.ts

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
```

`/api/interdiff` takes any number of `from` and `to` commit ids, each side in
`jj log` order, and answers with one row per lined-up pair. Commit ids rather
than change ids or revsets, because the two sides are routinely picked out of
different operations and only a commit id means the same thing in both.

The two sides need not be the same length, and neither has to be a single
commit. [`alignSeries`](series.md) decides which commit faces which; this
handler only turns each of its rows into a diff. A row with both sides is an
interdiff. A row with one side is a commit that was added to or dropped from
the series, and its own diff is the only honest thing to show for it. That
last rule is also what makes `from` empty, `to` a single commit reduce to
"pick a commit, read its diff", the v0 behaviour, with no separate endpoint.

Rows are built concurrently. Each one is a separate `jj` process, and jj
serialises nothing that matters for a read, so a ten-commit series costs about
what one commit costs.

Asking for no commits at all is the one case with no answer, and it is a 400.

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

### Reading a pull request from GitHub

The [GitHub backend](github.md) fails in more ways than jj does, and not all of
them are the caller's fault, so `githubJson` sorts them rather than flattening
everything into a 400 the way `jjJson` can. A `GitHubError` of kind `not-found`
is a 404, because the repository or the pull request the URL names does not
exist. Kind `upstream` is a 502, meaning GitHub was asked and did not answer. A
`GitError` is the least obvious 502: GitHub named a commit, we asked the remote
for it and the remote would not hand it over, so the request was well-formed
and the upstream is inconsistent. A `ZodError` is the only 400 left, and it
carries `z.prettifyError`'s rendering, which names the offending field instead
of making the caller guess.

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

`/api/github/pulls` is the picker's list and `/api/github/pull/history` is one
pull request's chain of heads. Both are thin: every parameter is parsed at the
top of the handler, so a bad one costs a 400 and no API call.

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

`/api/github/pull/commits` is where the two backends meet: GitHub says which
heads the pull request has had, and the local object store says what the
commits under a given head are. The order of the four steps is the whole
design.

The ordering is a security property. [`pullStateAt`](github.md) resolves the
head against the pull request's own chain **before** anything is fetched. Why
that matters, and why a state is named by its head rather than by its version,
are written down with the lookup.

The base is the pull request's base branch tip now, not what it was then, which
is all GitHub keeps. `git log <base>..<head>` is therefore "the commits this
head has that the base does not", which is the right answer for a pull request
that has been rebased and the only available answer for one that has not.

`gitMaterialize` returns one witness per oid asked, so the destructuring is
exhaustive by construction; the undefined check is there because
`noUncheckedIndexedAccess` cannot know that, and a mismatch would be our bug
and a 500.

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

`/api/github/pull/diff` is the review itself. `to` names a head of the pull
request. `from` names what that head is measured against, either another head
or the word `base`, and the two ends are parsed apart at the top of the
handler so a value that is neither costs a 400 and no API call. A head is
named by its oid rather than by its version number, for the reason
[`pullStateAt`](github.md) gives. That also makes "version 7 of a pull request
that now has three versions" a request nobody can write, rather than one more
thing to reject.

Only the before end can be the base, which is why `from` is a `PullBaseline`
and `to` stays a `GitOid`. The base as the after end is the pull request read
backwards, and nobody reads it that way. The commit strip beside the diff
takes the same `to`, and a base branch tip has no list of commits to show for
a pull request.

Two heads of the same pull request are compared with [`jjInterdiff`](jj.md).
The later head is usually the earlier one rebased, and interdiff drops what
the rebase carried along; for pull request #9 of this repository, first head
against last, that is the difference between three files and forty-seven. A
tree diff between two heads reports the rebase itself as a change, which is
the comparison GitHub shows on the pull request page and not the one a
reviewer of a re-push is asking for.

A head against the base is the other comparison, and it is the three-dot diff,
[`gitMergeBase`](git.md) and then [`jjDiffBetween`](jj.md). It is not a diff
from `baseRefOid`. That oid is the base branch's tip now, so a diff from it
carries every commit the base branch has gained since the branch was cut, in
reverse, on top of the pull request's own work. On pull request #21 of this
repository, merged, today's `main` against the final head names fifty-one
files and the merge base against it names none, which is the truth about a
pull request whose work is already in `main`.

A second comparison was refused here for as long as it would have gone
unlabelled, since a reader would then be working out which of two answers is
in front of them. The comparison picker's caption names which one is on
screen, so that reader does not exist. Each comparison is worth naming once.
The interdiff says how the change itself evolved. The base comparison says
what the pull request introduces. The picker now offers the base as the
before end, so this is the whole of what the route needs to serve.

The two comparisons use `gitMaterialize` differently, and `pullDiffFiles`
holds that along with the choice. Comparing two heads needs only that the call
returned, because jj takes a plain commit id and `gitMaterialize` throws
unless every object landed. Comparing against the base reads the witnesses it
hands back, because `gitMergeBase` takes a `LocalOid` on each side.
[`pullPins`](github.md) already pins the base alongside the head, so that path
fetches nothing the interdiff path would not have fetched.

The baseline is tagged rather than left as a bare oid the server recognises
by comparing it against `history.baseRefOid`. That comparison answers the
wrong thing. The oid is read when the history is fetched and sent back when
the diff is fetched, so a commit landing on the base branch in between makes
the equality fail and answers a reviewer who picked the base with a 404. A
branch force-pushed to exactly the base tip puts that same oid legitimately in
the chain of heads, where the equality would quietly switch comparisons under
a reviewer who picked a version. Asking for the base and asking for a version
are different operations over different commits, and a union is what says so.

The body is exported separately from the handler so the tests can hand it a
GitHub transport. Its three siblings are pass-throughs, and everything they do
past parsing is already covered against a stubbed transport in the [GitHub
backend](github.md)'s own tests. This one chooses a diff and chooses what to
fetch, which is behaviour worth pinning at the route. The seam sits beside the
handler rather than in its signature, because `Bun.serve` calls a route handler
with a second argument of its own.

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

The route table is the list of handlers the server exposes.

```ts
//| id: backend-server

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
```

### Route tests

Each handler is a plain `Request` → `Response` function, so the tests call it
without binding a port.

```ts
//| id: backend-server-test
//| file: src/server.test.ts
import { describe, expect, test } from "bun:test";
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


The GitHub routes are only tested for what they refuse. Every other case talks
to GitHub, and a test suite that needs a token and a network fails for reasons
unrelated to the code. What these pin is that a malformed parameter is a 400
and costs no API call, which is the same as saying the parse happens first.

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

## Quality

### Testing

`bun test` is our test runner. Having fewer deps is nice.

```just
#| id: just-bun-test
# Run tests
@test:
  bun test
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

The diff route is the one GitHub route tested for more than what it refuses,
and it gets there without a token or a network. Its transport is a stub
returning a pull request whose base and heads are three commits from the root
of this repository's own history. Those commits are already in the object
store, so `gitMaterialize` finds them and fetches nothing. What is left under
test is the route's own decisions, and each answer is checked against the jj
call it should have made rather than against a file count, because a file count
would still pass if the two diffs were swapped.

`divergedPull` is what separates the merge base from the base branch tip.
Every other case has a base that is already an ancestor of the head, where the
diff from the base and the diff from the merge base are the same diff and an
implementation handing `baseRefOid` straight to `jjDiffBetween` passes. The
parents of a merge are where this repository keeps a base and a head that have
genuinely diverged, and the base side also has to carry something the merge
base does not, which is what makes the two diffs differ at all. That case
asserts both halves, that the answer is the diff from the commit the two
share, and that it is not the diff from the base.

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
    for (const merge of await jjLog({ revset: "merges()" })) {
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
        const moved = await jjDiffBetween({ from: mergeBase, to: base });
        if (moved.length > 0) return { base, head, mergeBase };
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
```
