# Frontend

The review UI is a small [React](https://react.dev/) app. It has two commit
pickers, *before* and *after*, each drawn as a commit graph, and one diff panel.
Pick a commit on each side and the panel shows their interdiff: how the after
commit's change differs from the before commit's.

Either side takes any number of commits. Pick a whole branch on the left and
the branch it became on the right, and the panel shows one row per commit,
lined up by [`alignSeries`](backend/series.md) and scrolled like a branch.
Reviewing a re-pushed series is the case the tool is for, and it is not a
commit-at-a-time job.

An operation selector sits above each picker. jj records every repo mutation as
an operation; picking a past one rewinds that side's log to how it looked right
after that step, via `jj ... --at-operation`. The two sides choose
independently. A commit as it stood ten operations ago and the same commit now
are exactly the pair worth comparing, and no single view of the repo holds
both.

A commit with nothing opposite it shows its own diff, whether that is because
the reader picked one side only or because the commit was added to or dropped
from the series. "Pick a commit, read its diff" is then this same screen with
an empty before side, rather than a second mode to switch into.

A pull request is the same comparison over a history nobody has locally. Every
force push replaces the branch's head, so one that has been pushed six times
has had seven heads, and its first head against its latest is exactly the
interdiff this tool is for. A switch at the top of the window chooses between
the two screens, `Local history` and `Pull requests`. Everything below that
switch is shared: the same commit graph, the same diff panel, and one `Source`
type saying where a side's commits come from.

The two screens differ because the two histories do. A jj operation log is deep
and arbitrary, so picking a point in it wants a dropdown. A pull request has
had a handful of heads in a known order, so they fit on one line as a timeline
of chips with both ends of the comparison marked on it at once.

The tech plan first sketched this in htmx. We went with React instead. The
pickers carry client-side state. Two selections drive the diff panel, and both
have to survive every reload of either side. Component state does that cleanly. htmx
would need a stack of out-of-band swaps.

## Architecture

The app has four layers plus a root. Imports point one way down this list:

```
index.html + main.tsx   mount point
        |
      App.tsx            root, owns the shared selections
        |
   controllers/          wire a state hook to a view
      /       \
 state/        views/    state/ owns data and keeps it loaded
        |                views/ turn props into markup
     api.ts              transport, fetch plus Zod, no React
```

Each layer is named for the job it does. The `state/` modules are React hooks.
A folder called `hooks/` would say nothing, because any hook can do anything.
`state/` says what these ones are for.

### transport

`api.ts` does all the talking to the backend. It knows the backend's URLs and
their wire formats. It knows nothing about React. It holds one schema and one
wrapper per endpoint, and every wrapper parses its response through that
[Zod](https://zod.dev/) schema before returning it, so a drift in a backend
shape fails at the fetch with a named parse error instead of reaching a view as
`undefined`. The code block below is the inventory. Adding an endpoint means
adding a schema and a wrapper beside it and nothing else.

Two conventions run through the arguments. An optional `atOperation` is the jj
operation to read history at, and leaving it out reads the live repo. Anything
that names a commit names it by id rather than by a revset or a change id,
because an id means the same commit in every view of the repo. A pull request
head follows the same rule in git's spelling, as a `GitOid`.

### state

Each `state/` module owns one slice of the app's data and keeps it current with
the backend. `useOperations` owns the operation list. `useCommits` owns the
commit list for one side's `Source`, so there is one instance of it per side,
and it is the only place a source becomes a request. `useComparison` owns what
the diff panel shows. `usePulls` and `usePullHistory` own the pull request list
and one pull request's chain of heads. One module loads its slice, reloads it
when the input changes, and holds the loading and error state around it.

`useEffect` plus fetch plus cancel-on-change is fiddly, and it runs the same
way for every slice. It lives here once. A fetching `useEffect` appears nowhere
else.

Every hook returns an `AsyncState<T>`, the union `loading | error | ready`. A
caller switches on `status`, and the union forces it to cover every case. No
gap opens up where the load has finished but the data is still missing.
`useComparison` returns `null` when there is nothing to ask the backend for.
Its caller shows a prompt in that state.

### views

A view in `views/` is a pure function from props to markup. Give it data and
callbacks, get elements back. It never fetches or calls into `api.ts`, and
nothing in it hints that a server exists.

These are the files you restyle and test. A test renders one with fixture props
and checks the output. There is nothing to mock.

Views take the wire types from `api.ts` as props. `CommitGraph` takes
`LogEntry[]`. `DiffView` takes `FileDiff[]`. This holds while the UI shows
exactly what the API returns. When it stops matching, add view-model types and
map to them in the controllers. Until then, skip them. A copy of the wire types
only drifts from the original.

### controllers

A controller in `controllers/` wires one state hook to one view. It calls the
hook and reads the `AsyncState`. Then it renders the view or a `Message`. It
has no markup of its own.

When there is no diff to show yet, the controller decides what goes on screen,
so `DiffView` stays at "render these files" with no null checks and one panel's
branching sits in one file. `OperationLog` drives `OperationPicker`. `CommitLog`
drives `CommitGraph`. `DiffPane` drives whichever of `InterdiffRows` and
`DiffView` the answer it got calls for.

`PullReview` bends the one-hook-one-view rule and is the only thing that does.
It mounts the commit list and the diff panel itself, because neither can be
asked for until the pull request's history has come back and said which head is
the latest. Hoisting the head into `App` would mean `App` holding a value it
cannot compute, and an effect to fill it in later.

### root

`App.tsx` holds two things per side: the `Source` its commits come from, and
which of those commits are selected. Each is read by more than one controller,
and `App` is their common parent, so `App` is where they live. `useSide` is
that pair and its two setters, written once and called twice, because the two
sides differ in nothing but which half of the comparison they feed. It is
generic over the kind of source, so a screen that only ever shows jj operations
holds a side whose source is known to be one and reaches the operation id
without a runtime check. It stays in `App.tsx` rather than `state/`, which is
for slices backed by the server; this one never touches the network.

Changing a side's source also clears its selected commits, since a commit
listed under one source need not appear under another. `ReviewPanes` handles
the layout: the two pickers as narrow columns, the diff taking the rest.

`App` also holds the mode switch, and the repository the pull request screen
reads. The repository is one named constant and is the next thing here worth
making configurable; a view never sees it except as a prop.

Which head of a pull request is being read is *not* in `App`. Nothing outside
the pull request pane needs it, and the pane already remounts when the selected
pull request changes, which resets the two ends of the comparison for free.

### Keeping the boundary honest

The one-way import rule is a convention today. Nothing stops a view from
importing `fetchDiff` for "just one more field". The first time that happens,
the split is gone and the view needs a running server to test again. A
follow-up adds a Biome `noRestrictedImports` rule per directory. The boundary
then fails the build without waiting for a reviewer to notice.

Allowed import edges:

- `api.ts` imports Zod only.
- `state/` imports React and `api.ts`.
- `views/` imports React, other `views/`, and `api.ts` *types*.
- `controllers/` import `state/`, `views/`, and `api.ts` *types*.
- `App.tsx` imports `controllers/`, `views/`, and `api.ts` *types*.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack).
Bun's bundler finds the `<script>` and `<link>` tags and bundles them, along
with the React and JSX they pull in. `Bun.serve()` returns the bundle from `/`.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Diffy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`main.tsx` mounts the React tree into `#root`. That is its whole job.

```tsx
//| id: frontend-entry
//| file: src/frontend/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) throw new Error("missing #root element");

createRoot(container).render(<App />);
```

## Transport

`api.ts` has one Zod schema and one `fetch` wrapper per endpoint. `JjFileDiff`
is a discriminated union on `status`. `added`, `deleted`, and `modified` carry
a single `path`. `renamed` and `copied` carry `oldPath` and `newPath`.

`LogEntry.changeId` is nullable because a GitHub pull request's commits are
plain git commits, and a git commit has no change id. The field stays
required, so a backend without one has to say `changeId: null`. Defaulting a
missing key to null reads as more forgiving and costs more than it gives. A
jj backend that stopped emitting `change_id` through a bug of its own would
parse cleanly, and every row would quietly lose its rewrite-stable identity
with nothing raised to say why. A missing field is a backend nobody taught
about this one, and it should fail at the boundary.
[`alignSeries`](backend/series.md) has what pairing does without an id.

`GitOid` is branded, so the only way to hold one is to have parsed it out of a
backend response. A head oid cannot be typed into the app by hand, which is
what makes the guarantee in the next section hold at compile time.

```ts
//| id: frontend-api
//| file: src/frontend/api.ts
import * as z from "zod";

/** A full 40-hex git object id. Branded: only a parsed response mints one. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

export const LogEntry = z.object({
  commitId: z.string(),
  changeId: z.string().nullable(),
  description: z.string(),
  parents: z.array(z.string()),
});
export type LogEntry = z.infer<typeof LogEntry>;

const LogResponse = z.array(LogEntry);

export const OpLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  time: z.string(),
  args: z.string(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;

const OpLogResponse = z.array(OpLogEntry);

const fileDiffFields = {
  binary: z.boolean(),
  patch: z.string(),
};

export const FileDiff = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), path: z.string(), ...fileDiffFields }),
  z.object({
    status: z.literal("deleted"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("modified"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("renamed"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("copied"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
]);
export type FileDiff = z.infer<typeof FileDiff>;

const DiffResponse = z.object({
  revision: z.string(),
  files: z.array(FileDiff),
});
export type DiffResponse = z.infer<typeof DiffResponse>;

export const InterdiffRow = z.object({
  from: LogEntry.nullable(),
  to: LogEntry.nullable(),
  files: z.array(FileDiff),
});
export type InterdiffRow = z.infer<typeof InterdiffRow>;

const InterdiffResponse = z.object({ rows: z.array(InterdiffRow) });
export type InterdiffResponse = z.infer<typeof InterdiffResponse>;

const ErrorResponse = z.object({ error: z.string() });

/** GET a jj-backed endpoint, turning a 400 into its `error` message. */
async function getJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  const body: unknown = await res.json();

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
    );
  }

  return body;
}

export async function fetchOperations(): Promise<OpLogEntry[]> {
  return OpLogResponse.parse(
    await getJson("/api/operations", "GET /api/operations"),
  );
}

export async function fetchLog(atOperation?: string): Promise<LogEntry[]> {
  const query = atOperation ? `?op=${encodeURIComponent(atOperation)}` : "";
  return LogResponse.parse(await getJson(`/api/log${query}`, "GET /api/log"));
}

export async function fetchDiff(
  revision: string,
  atOperation?: string,
): Promise<DiffResponse> {
  const params = new URLSearchParams({ rev: revision });
  if (atOperation) params.set("op", atOperation);
  return DiffResponse.parse(
    await getJson(`/api/diff?${params}`, "GET /api/diff"),
  );
}

export async function fetchInterdiff(
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return InterdiffResponse.parse(
    await getJson(`/api/interdiff?${params}`, "GET /api/interdiff"),
  );
}
```

### Where a side's commits come from

A side of the comparison is a list of commits, and there is more than one place
those commits can come from. A jj operation gives the local repo as it stood
after that step. A head of a pull request gives a branch on GitHub as it stood
before somebody force-pushed over it. `Source` is that choice, a tagged union
rather than an operation with a pull request hanging off it, so a side is
always exactly one of the two and no view has to ask which.

A pull request head is named by its object id and never by the version number
the timeline shows. A version is a position in a chain that shifts, so `v7` can
come to mean a different commit while the page is open; the backend's
`pullStateAt` has the full account. Holding the oid makes "show me version 7 of
a pull request that now has three versions" a request nobody can express.

```ts
//| id: frontend-api

/** A view of the local repo: the jj operation to read its log at. */
export type JjSource = { kind: "jj"; operation: string | null };

/** One head a pull request has had, named by oid because versions shift. */
export type PullSource = {
  kind: "pull";
  repo: string;
  number: number;
  head: GitOid;
};

/** Where one side's commits come from. */
export type Source = JjSource | PullSource;

export const GitCommit = z.object({
  commitId: GitOid,
  parents: z.array(GitOid),
  description: z.string(),
  author: z.string(),
  authoredAt: z.string(),
});
export type GitCommit = z.infer<typeof GitCommit>;

const PullCommitsResponse = z.object({
  head: GitOid,
  version: z.number(),
  base: GitOid,
  commits: z.array(GitCommit),
});
export type PullCommitsResponse = z.infer<typeof PullCommitsResponse>;

export async function fetchPullCommits(
  repo: string,
  number: number,
  head: GitOid,
): Promise<PullCommitsResponse> {
  const params = new URLSearchParams({ repo, number: String(number), head });
  return PullCommitsResponse.parse(
    await getJson(
      `/api/github/pull/commits?${params}`,
      "GET /api/github/pull/commits",
    ),
  );
}
```

### Reading a pull request

The pull request screen calls its endpoints in the order the reader moves
through them: the repository's pull requests, then one pull request's chain of
heads, then the diff at or between those heads.

`fetchPullDiff` takes `from` and `to` as two required heads, because the
route answers one comparison and it needs both ends. The
[route's own doc](backend/server.md) says why that comparison is an
interdiff and not a tree diff against the base branch.

```ts
//| id: frontend-api

export const PullState = z.enum(["OPEN", "CLOSED", "MERGED"]);
export type PullState = z.infer<typeof PullState>;

export const PullSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: PullState,
  author: z.string(),
  updatedAt: z.string(),
  headRefOid: GitOid,
  baseRefName: z.string(),
  url: z.string(),
});
export type PullSummary = z.infer<typeof PullSummary>;

const PullsResponse = z.array(PullSummary);

/** How a head became the head. Only a force push has a time to show. */
export const PullHeadOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opened") }),
  z.object({ kind: z.literal("force-pushed"), at: z.string() }),
  z.object({ kind: z.literal("current") }),
]);
export type PullHeadOrigin = z.infer<typeof PullHeadOrigin>;

export const PullVersion = z.object({
  /** Position in the chain. A label to show, never a way to ask for a state. */
  version: z.number(),
  head: GitOid,
  origin: PullHeadOrigin,
});
export type PullVersion = z.infer<typeof PullVersion>;

export const PullHistory = z.object({
  number: z.number(),
  baseRefName: z.string(),
  baseRefOid: GitOid,
  /** Oldest first. The last one is the head the branch has now. */
  states: z.array(PullVersion),
  truncated: z.boolean(),
});
export type PullHistory = z.infer<typeof PullHistory>;

const PullDiffResponse = z.object({
  from: GitOid,
  to: GitOid,
  files: z.array(FileDiff),
});
export type PullDiffResponse = z.infer<typeof PullDiffResponse>;

export async function fetchPulls(
  repo: string,
  state: "open" | "closed" | "merged" | "all",
): Promise<PullSummary[]> {
  const params = new URLSearchParams({ repo, state });
  return PullsResponse.parse(
    await getJson(`/api/github/pulls?${params}`, "GET /api/github/pulls"),
  );
}

export async function fetchPullHistory(
  repo: string,
  number: number,
): Promise<PullHistory> {
  const params = new URLSearchParams({ repo, number: String(number) });
  return PullHistory.parse(
    await getJson(
      `/api/github/pull/history?${params}`,
      "GET /api/github/pull/history",
    ),
  );
}

export async function fetchPullDiff(
  repo: string,
  number: number,
  to: GitOid,
  from: GitOid,
): Promise<PullDiffResponse> {
  const params = new URLSearchParams({
    repo,
    number: String(number),
    to,
    from,
  });
  return PullDiffResponse.parse(
    await getJson(
      `/api/github/pull/diff?${params}`,
      "GET /api/github/pull/diff",
    ),
  );
}
```

## State

Every slice reports its status as an `AsyncState<T>`.

```ts
//| id: frontend-async-state
//| file: src/frontend/state/asyncState.ts
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
```

`useOperations` loads the operation list once, on mount.

```tsx
//| id: frontend-state-operations
//| file: src/frontend/state/operations.ts
import { useEffect, useState } from "react";
import { fetchOperations, type OpLogEntry } from "../api";
import type { AsyncState } from "./asyncState";

export function useOperations(): AsyncState<OpLogEntry[]> {
  const [state, setState] = useState<AsyncState<OpLogEntry[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    fetchOperations()
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
```

`useCommits` takes a side's `Source` and reloads whenever it changes, dropping
a response that lands after the source has moved on again. `commitsFrom` is the
one place in the app that dispatches on `source.kind`, so adding a third kind
of source is one branch here and nothing anywhere else.

A git commit has no change id. `commitsFrom` puts its commit id in that field,
because the graph rows abbreviate the change id and the abbreviation of a
commit id is the short oid, which is how GitHub names the same commit on the
same screen.

A source is an object, freshly built every render, so the effect cannot depend
on it directly without restarting on every render. It depends on the source's
JSON instead and reads the source back out of that JSON, which keeps one source
of truth rather than a dependency list that has to be kept in step with the
body by hand.

```tsx
//| id: frontend-state-commits
//| file: src/frontend/state/commits.ts
import { useEffect, useState } from "react";
import {
  fetchLog,
  fetchPullCommits,
  type GitCommit,
  type LogEntry,
  type Source,
} from "../api";
import type { AsyncState } from "./asyncState";

function asLogEntry(commit: GitCommit): LogEntry {
  return {
    commitId: commit.commitId,
    changeId: commit.commitId,
    description: commit.description,
    parents: commit.parents,
  };
}

/** The commits a source names. The one place a `Source` decides anything. */
export async function commitsFrom(source: Source): Promise<LogEntry[]> {
  if (source.kind === "jj") {
    return fetchLog(source.operation ?? undefined);
  }

  const { commits } = await fetchPullCommits(
    source.repo,
    source.number,
    source.head,
  );
  return commits.map(asLogEntry);
}

export function useCommits(source: Source): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });
  const key = JSON.stringify(source);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    commitsFrom(JSON.parse(key) as Source)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}
```

The dispatch is tested through `commitsFrom`, which is a plain async function,
so the test needs no renderer. It serves one canned response and checks both
the commits that come back and the URL that was asked for. The values alone
would not catch a source reaching the wrong endpoint and being parsed anyway.

```ts
//| id: frontend-state-commits-test
//| file: src/frontend/state/commits.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { GitOid } from "../api";
import { commitsFrom } from "./commits";

const liveFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = liveFetch;
});

/** Answer every request with one canned body, recording what was asked for. */
function serve(body: unknown): string[] {
  const asked: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  return asked;
}

const HEAD = GitOid.parse("6f24fa3fd3438f5ebe25018b5d6ba471bf119b45");
const BASE = GitOid.parse("e28c33e61b920728d79d099a9963ff23a865ef98");

describe("commitsFrom", () => {
  test("reads a jj source out of the live commit log", async () => {
    // arrange
    const entries = [
      { commitId: "c1", changeId: "k1", description: "one", parents: [] },
    ];
    const asked = serve(entries);

    // act
    const commits = await commitsFrom({ kind: "jj", operation: null });

    // assert
    expect(commits).toEqual(entries);
    expect(asked).toEqual(["/api/log"]);
  });

  test("reads a jj source at the operation it names", async () => {
    // arrange
    const asked = serve([]);

    // act
    await commitsFrom({ kind: "jj", operation: "0a1b2c" });

    // assert
    expect(asked).toEqual(["/api/log?op=0a1b2c"]);
  });

  test("reads a pull source out of that head's commits", async () => {
    // arrange
    const asked = serve({
      head: HEAD,
      version: 7,
      base: BASE,
      commits: [
        {
          commitId: HEAD,
          parents: [BASE],
          description: "frontend: give the graph side-by-side branch lanes",
          author: "glencbz",
          authoredAt: "2026-09-10T09:00:00Z",
        },
      ],
    });

    // act
    const commits = await commitsFrom({
      kind: "pull",
      repo: "glencbz/diffy",
      number: 9,
      head: HEAD,
    });

    // assert
    expect(commits).toEqual([
      {
        commitId: HEAD,
        changeId: HEAD,
        description: "frontend: give the graph side-by-side branch lanes",
        parents: [BASE],
      },
    ]);
    expect(asked[0]).toBe(
      `/api/github/pull/commits?repo=glencbz%2Fdiffy&number=9&head=${HEAD}`,
    );
  });
});
```

`useComparison` owns the diff panel's contents. A `Comparison` is the question,
and it has one arm per screen: a pair of commit selections out of the local
repo, or a pair of heads of one pull request.

Only the jj arm has a "nothing picked yet" state, an empty `from` array,
which the backend already answers by showing the after side's own diff. The
pull arm has no such state. Both its ends are required heads, and the
controller always has one to fall back on, the pull request's first head.

The hook reloads whenever the question changes and drops a response that lands
after it has changed again. Both jj selections empty is the one question with
no answer, so the hook reports `null` without a request. A comparison is a
fresh object every render, so the effect depends on its JSON the same way
`useCommits` depends on a source's.

```tsx
//| id: frontend-state-comparison
//| file: src/frontend/state/comparison.ts
import { useEffect, useState } from "react";
import {
  type FileDiff,
  fetchInterdiff,
  fetchPullDiff,
  type GitOid,
  type InterdiffRow,
} from "../api";
import type { AsyncState } from "./asyncState";

/** What the diff panel is being asked for. */
export type Comparison =
  | { kind: "jj"; from: string[]; to: string[] }
  | {
      kind: "pull";
      repo: string;
      number: number;
      /** The earlier head. */
      from: GitOid;
      to: GitOid;
    };

/** The answer, shaped by what was asked. */
export type ComparisonFiles =
  | { kind: "jj"; rows: InterdiffRow[] }
  | { kind: "pull"; files: FileDiff[] };

async function compare(question: Comparison): Promise<ComparisonFiles> {
  if (question.kind === "jj") {
    const { rows } = await fetchInterdiff(question.from, question.to);
    return { kind: "jj", rows };
  }

  const { files } = await fetchPullDiff(
    question.repo,
    question.number,
    question.to,
    question.from,
  );
  return { kind: "pull", files };
}

function hasNothingToAsk(question: Comparison): boolean {
  return (
    question.kind === "jj" &&
    question.from.length === 0 &&
    question.to.length === 0
  );
}

export function useComparison(
  question: Comparison,
): AsyncState<ComparisonFiles> | null {
  const [state, setState] = useState<AsyncState<ComparisonFiles> | null>(null);
  const key = hasNothingToAsk(question) ? "" : JSON.stringify(question);

  useEffect(() => {
    if (key === "") {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    compare(JSON.parse(key) as Comparison)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}
```

`usePulls` loads the repository's pull requests in every state. A merged pull
request that was force-pushed on the way is exactly the history worth reading
back, and a list of open ones would never reach it.

```tsx
//| id: frontend-state-pulls
//| file: src/frontend/state/pulls.ts
import { useEffect, useState } from "react";
import { fetchPulls, type PullSummary } from "../api";
import type { AsyncState } from "./asyncState";

export function usePulls(repo: string): AsyncState<PullSummary[]> {
  const [state, setState] = useState<AsyncState<PullSummary[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPulls(repo, "all")
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo]);

  return state;
}
```

`usePullHistory` loads one pull request's chain of heads. Everything the review
pane shows below the header depends on it, down to which head counts as the
latest, so it loads first and on its own.

```tsx
//| id: frontend-state-pull-history
//| file: src/frontend/state/pullHistory.ts
import { useEffect, useState } from "react";
import { fetchPullHistory, type PullHistory } from "../api";
import type { AsyncState } from "./asyncState";

export function usePullHistory(
  repo: string,
  number: number,
): AsyncState<PullHistory> {
  const [state, setState] = useState<AsyncState<PullHistory>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPullHistory(repo, number)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo, number]);

  return state;
}
```

## Views

### ReviewPanes

Three columns: the two pickers, then the diff. The pickers are narrow and
fixed; the diff takes what is left, because it is the thing being read. Each
picker column carries its own caption, since "before" and "after" are the only
labels that say which direction the interdiff runs.

The panes fill whatever `App` gives them rather than claiming the viewport,
because the mode switch sits above them and takes a strip of it.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";

export function ReviewPanes({
  before,
  after,
  diff,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <PickerColumn caption="before">{before}</PickerColumn>
      <PickerColumn caption="after">{after}</PickerColumn>
      <div style={{ flex: 1, overflow: "auto" }}>{diff}</div>
    </div>
  );
}

function PickerColumn({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "25%",
        minWidth: 240,
        borderRight: "1px solid #ccc",
      }}
    >
      <h2
        style={{
          margin: 0,
          padding: "6px 8px",
          font: "inherit",
          fontWeight: "bold",
          background: "#f0f0f0",
          borderBottom: "1px solid #ccc",
        }}
      >
        {caption}
      </h2>
      <div style={{ overflow: "auto" }}>{children}</div>
    </div>
  );
}
```

### Message

The controllers route all of their status text through this one component.

```tsx
//| id: frontend-view-message
//| file: src/frontend/views/Message.tsx
import type { ReactNode } from "react";

export function Message({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <p style={{ padding: 12, color: tone === "error" ? "#cf222e" : "#333" }}>
      {children}
    </p>
  );
}
```

### Operation picker

A single `<select>` above the graph. The first option is "latest (current)",
value `""`, which maps back to `null` (the live repo). The rest are operations
newest first, each labelled with its short id, its description or the command
that caused it, and when it finished. `onSelect` gets the operation id, or
`null` for latest.

```tsx
//| id: frontend-view-operation-picker
//| file: src/frontend/views/OperationPicker.tsx
import type { OpLogEntry } from "../api";

export function OperationPicker({
  operations,
  selected,
  onSelect,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderBottom: "1px solid #ccc",
      }}
    >
      <span style={{ color: "#888" }}>operation</span>
      <select
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        style={{ flex: 1, font: "inherit" }}
      >
        <option value="">latest (current)</option>
        {operations.map((operation) => (
          <option key={operation.id} value={operation.id}>
            {optionLabel(operation)}
          </option>
        ))}
      </select>
    </label>
  );
}

function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
```

### Commit label

The graph rows and the diff panel's header both name a commit the same way: its
short change id, then the first line of its description. One component, so the
two never drift apart.

A commit with no change id falls back to its short commit id, in italic. The
two are not the same promise. A change id is the commit's identity across a
rewrite; a commit id names one revision and does not survive an amend.
Rendering them identically would invite a reader to trust the wrong one. The
cue stays small and stays in the same dim `#888`, because on a git-backed row
this is ordinary, not an error.

```tsx
//| id: frontend-view-commit-label
//| file: src/frontend/views/CommitLabel.tsx
import type { LogEntry } from "../api";

export function CommitLabel({ commit }: { commit: LogEntry }) {
  const summary = commit.description.split("\n")[0] ?? "";
  const shortId =
    commit.changeId !== null
      ? commit.changeId.slice(0, 8)
      : commit.commitId.slice(0, 8);
  return (
    <>
      <span
        style={{
          color: "#888",
          marginRight: 8,
          fontStyle: commit.changeId !== null ? "normal" : "italic",
        }}
      >
        {shortId}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {summary || <em style={{ color: "#999" }}>(no description)</em>}
      </span>
    </>
  );
}
```

### Comparison header

Every row says what it is showing before it shows it: which commit is the
before side, which is the after side, and when one of them is missing. Without
it a row is an unlabelled patch, and with two independent operation pickers on
screen and several rows stacked up, there is no way to work back to what was
compared.

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  from,
  to,
}: {
  from: LogEntry | null;
  to: LogEntry | null;
}) {
  return (
    <header
      style={{
        padding: "8px 12px",
        background: "#fafafa",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Row caption="before" commit={from} />
      <Row caption="after" commit={to} />
    </header>
  );
}

function Row({
  caption,
  commit,
}: {
  caption: string;
  commit: LogEntry | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "#888", width: 56, flex: "none" }}>{caption}</span>
      {commit === null ? (
        <em style={{ color: "#999" }}>not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}
```

### Commit graph

Side-by-side branch lanes. One node per commit, top to bottom in the order the
backend sent them, where a child always lands above its parents. Each lane
tracks the commit it is currently routing toward. A commit takes the leftmost
lane already pointing at it, or a fresh lane when none is. Its first parent
stays in that lane; the extra parents of a merge fan out into their own lanes,
and a commit with more than one parent draws as a hollow node. A lane that
already points at a parent absorbs the incoming branch instead of doubling up,
which is how a side branch collapses back into its base.

`layoutGraph` is the whole algorithm, and it is pure, commits in, lanes and
edges out. The view just turns each row into an `<svg>` gutter. Lane colour is
cycled by index so parallel branches stay distinct, and lane zero stays grey,
so a linear history looks the same as `jj log`.

Clicking a row toggles that commit by commit id, while the row goes on showing
a change id, which is shorter and is what `jj log` prints. The two are not
interchangeable as identifiers. A change id names whichever version of a commit
the current view holds, so it says something different in each operation's log,
and a selection has to keep meaning the one commit the reader clicked.

Any number of rows can be selected, and the graph hands back the whole
selection rather than the row that was clicked. It orders that selection the
way the log is ordered, because it is the only piece of the app that knows what
the order is. Click order would line a series up against the other side in
whatever sequence the reader happened to click.

`onSelect` is optional. Without it the same graph draws a history that is read
rather than picked from, which is what the pull request screen needs. Its two
ends are chosen on the timeline, so a clickable row would be a control that
changes nothing.

```tsx
//| id: frontend-view-commit-graph
//| file: src/frontend/views/CommitGraph.tsx
import type { CSSProperties } from "react";
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;

// Lane zero stays grey, so a linear history is unchanged; branches get colour.
const LANE_COLORS = [
  "#333",
  "#0969da",
  "#1a7f37",
  "#8250df",
  "#bf8700",
  "#1b7c83",
  "#cf222e",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] as string;
}

export type GraphEdge = { from: number; to: number };

export type GraphRow = {
  /** Lane holding this commit's node. */
  lane: number;
  isMerge: boolean;
  /** Top-half segments, drawn from (from, y=0) to (to, y=middle). */
  incoming: GraphEdge[];
  /** Bottom-half segments, drawn from (from, y=middle) to (to, y=bottom). */
  outgoing: GraphEdge[];
};

export type GraphLayout = {
  rows: GraphRow[];
  /** Widest lane count any row reaches; drives the gutter width. */
  laneCount: number;
};

/**
 * Assign every commit a lane and the edges linking it to its parents. Input
 * order is the backend's: a child always precedes its parents. `lanes[i]` is
 * the commitId lane `i` is routing toward, or null when the lane is free.
 */
export function layoutGraph(commits: LogEntry[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 1;

  const firstFree = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const above = lanes.slice();

    // The node sits in the leftmost lane already routing to it, else a new one.
    const claimed = above
      .map((id, i) => (id === commit.commitId ? i : -1))
      .filter((i) => i !== -1);
    const lane = claimed.length > 0 ? (claimed[0] as number) : firstFree();

    // Every lane that was routing to this commit terminates at the node.
    for (const i of claimed) lanes[i] = null;
    lanes[lane] = null;

    const incoming: GraphEdge[] = [];
    for (let i = 0; i < above.length; i++) {
      if (above[i] === null) continue;
      incoming.push({ from: i, to: above[i] === commit.commitId ? lane : i });
    }

    // Route each parent: reuse a lane already heading there, else the node's
    // own lane for the first parent, else a free lane.
    const outgoing: GraphEdge[] = [];
    for (const [k, parent] of commit.parents.entries()) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = k === 0 ? lane : firstFree();
        lanes[target] = parent;
      }
      outgoing.push({ from: lane, to: target });
    }

    // Lanes that run straight through this row, unchanged.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && lanes[i] === above[i]) {
        outgoing.push({ from: i, to: i });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lane + 1, lanes.length, above.length);

    rows.push({
      lane,
      isMerge: commit.parents.length > 1,
      incoming,
      outgoing,
    });
  }

  return { rows, laneCount };
}

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string[];
  /** Omit to draw a graph that is read but not picked from. */
  onSelect?: ((commitIds: string[]) => void) | undefined;
}) {
  const chosen = new Set(selected);

  function toggle(commitId: string, select: (commitIds: string[]) => void) {
    const next = new Set(chosen);
    if (next.has(commitId)) next.delete(commitId);
    else next.add(commitId);

    select(
      commits
        .filter((commit) => next.has(commit.commitId))
        .map((commit) => commit.commitId),
    );
  }

  const { rows, laneCount } = layoutGraph(commits);
  const gutterWidth = laneCount * LANE_WIDTH;

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index] as GraphRow;
        const style: CSSProperties = {
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: ROW_HEIGHT,
          padding: 0,
          border: "none",
          whiteSpace: "nowrap",
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          background: chosen.has(commit.commitId) ? "#d0e4ff" : "transparent",
        };
        const content = (
          <>
            <RowGraphic row={row} width={gutterWidth} />
            <CommitLabel commit={commit} />
          </>
        );

        return onSelect === undefined ? (
          <div key={commit.commitId} style={style}>
            {content}
          </div>
        ) : (
          <button
            type="button"
            key={commit.commitId}
            onClick={() => toggle(commit.commitId, onSelect)}
            style={{ ...style, cursor: "pointer" }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function RowGraphic({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={0}
          x2={x(edge.to)}
          y2={middle}
          stroke={laneColor(edge.to)}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={middle}
          x2={x(edge.to)}
          y2={ROW_HEIGHT}
          stroke={laneColor(edge.to)}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={middle}
        r={4}
        fill={row.isMerge ? "#fff" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
      />
    </svg>
  );
}
```

### Interdiff rows

One section per lined-up pair, in the order the backend sent them, which is the
order of the graphs that fed it. Each section is its own header and its own
patch, so a reader scrolls the comparison the way they scroll a branch.

A row with no files still renders, and says which kind of nothing it is. Two
commits that make the same change is the answer someone checking a rebase
wants; an empty commit on its own says something else. That branch lives here
rather than in the controller, because it is per row and the controller sees
the list.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import type { InterdiffRow } from "../api";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({ rows }: { rows: InterdiffRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader from={row.from} to={row.to} />
          {row.files.length === 0 ? (
            <p style={{ padding: 12, fontStyle: "italic", color: "#666" }}>
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView files={row.files} />
          )}
        </section>
      ))}
    </div>
  );
}

function rowKey(row: InterdiffRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}
```

A test pins the lane arithmetic: a linear run stays in lane zero, and a
fork/merge diamond puts the merge on a hollow node and collapses the side
branch back to lane zero.

```tsx
//| id: frontend-view-commit-graph-test
//| file: src/frontend/views/CommitGraph.test.ts
import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../api";
import { layoutGraph } from "./CommitGraph";

function commit(id: string, parents: string[]): LogEntry {
  return { commitId: id, changeId: `${id}-change`, description: id, parents };
}

describe("layoutGraph", () => {
  test("keeps a linear history in one lane", () => {
    const { rows, laneCount } = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.some((r) => r.isMerge)).toBe(false);
  });

  test("splits a fork and collapses the merge back to lane zero", () => {
    const { rows, laneCount } = layoutGraph([
      commit("m", ["l", "r"]),
      commit("l", ["base"]),
      commit("r", ["base"]),
      commit("base", []),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(rows.map((r) => r.isMerge)).toEqual([true, false, false, false]);
    // the merge node fans a second parent out into lane one...
    expect(rows[0]?.outgoing).toContainEqual({ from: 0, to: 1 });
    // ...and the right side branch routes back into lane zero.
    expect(rows[2]?.outgoing).toContainEqual({ from: 1, to: 0 });
  });
});
```

### Diff view

Renders each file's verbatim `git`-format patch. The one thing it adds is
color. `+` lines green, `-` lines red, `@@` hunk headers blue, file headers
grey. A binary file gets a placeholder in place of a patch body. The caller
always hands it a real `files` array. The controller deals with anything that
is not a rendered diff.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import type { FileDiff } from "../api";

export function DiffView({ files }: { files: FileDiff[] }) {
  return (
    <div style={{ padding: 12 }}>
      {files.map((file) => (
        <FileRow key={pathOf(file)} file={file} />
      ))}
    </div>
  );
}

function FileRow({ file }: { file: FileDiff }) {
  return (
    <section style={{ marginBottom: 16, border: "1px solid #ccc" }}>
      <header
        style={{
          background: "#f0f0f0",
          padding: "4px 8px",
          fontWeight: "bold",
        }}
      >
        <span style={{ color: "#666", marginRight: 8 }}>{file.status}</span>
        {pathOf(file)}
      </header>
      {file.binary ? (
        <p style={{ padding: 8, fontStyle: "italic", color: "#666" }}>
          Binary file, no textual diff.
        </p>
      ) : (
        <pre style={{ margin: 0, padding: 8, overflowX: "auto" }}>
          {file.patch.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
            <div key={index} style={{ color: lineColor(line) }}>
              {line === "" ? " " : line}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

function lineColor(line: string): string | undefined {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "#666";
  if (line.startsWith("diff --git ") || line.startsWith("index "))
    return "#666";
  if (line.startsWith("@@")) return "#0969da";
  if (line.startsWith("+")) return "#1a7f37";
  if (line.startsWith("-")) return "#cf222e";
  return undefined;
}
```

### Mode tabs

Two screens, one strip. The tabs sit above everything, because the choice they
make is which history is being read, and that governs the whole window.

```tsx
//| id: frontend-view-mode-tabs
//| file: src/frontend/views/ModeTabs.tsx
export type Mode = "local" | "pulls";

const CAPTIONS: Record<Mode, string> = {
  local: "Local history",
  pulls: "Pull requests",
};

export function ModeTabs({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <nav
      style={{
        display: "flex",
        flex: "none",
        background: "#f0f0f0",
        borderBottom: "1px solid #ccc",
      }}
    >
      {(Object.keys(CAPTIONS) as Mode[]).map((candidate) => (
        <button
          type="button"
          key={candidate}
          onClick={() => onSelect(candidate)}
          style={{
            padding: "6px 14px",
            font: "inherit",
            fontWeight: candidate === mode ? "bold" : "normal",
            color: candidate === mode ? "#0969da" : "#333",
            cursor: "pointer",
            border: "none",
            borderBottom:
              candidate === mode
                ? "2px solid #0969da"
                : "2px solid transparent",
            background: "transparent",
          }}
        >
          {CAPTIONS[candidate]}
        </button>
      ))}
    </nav>
  );
}
```

### Pull request state chip

A pull request is open, merged or closed, and a reader scanning a list should
tell which at a glance rather than by reading the word. One component, so the
list and the header colour them the same.

```tsx
//| id: frontend-view-pull-state-chip
//| file: src/frontend/views/PullStateChip.tsx
import type { PullState } from "../api";

const CHIP_COLORS: Record<PullState, string> = {
  OPEN: "#1a7f37",
  MERGED: "#8250df",
  CLOSED: "#cf222e",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span
      style={{
        flex: "none",
        padding: "0 6px",
        borderRadius: 3,
        background: CHIP_COLORS[state],
        color: "#fff",
        fontSize: 11,
      }}
    >
      {state.toLowerCase()}
    </span>
  );
}
```

### Pull request list

One row per pull request: its number, its state, its title, and the branch it
targets. The base branch is there because a pull request against a release
branch and one against `main` read differently, and the number alone does not
say which this is.

```tsx
//| id: frontend-view-pull-list
//| file: src/frontend/views/PullList.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullList({
  pulls,
  selected,
  onSelect,
}: {
  pulls: PullSummary[];
  selected: number | null;
  onSelect: (number: number) => void;
}) {
  return (
    <div>
      {pulls.map((pull) => (
        <button
          type="button"
          key={pull.number}
          onClick={() => onSelect(pull.number)}
          style={{
            display: "block",
            width: "100%",
            padding: "6px 8px",
            border: "none",
            borderBottom: "1px solid #eee",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            textAlign: "left",
            background: pull.number === selected ? "#d0e4ff" : "transparent",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}>#{pull.number}</span>
            <PullStateChip state={pull.state} />
          </span>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {pull.title}
          </span>
          <span style={{ color: "#888" }}>← {pull.baseRefName}</span>
        </button>
      ))}
    </div>
  );
}
```

### Pull request header

What is being read, on one line, including a link out to GitHub. The link is
there because half of reviewing a pull request is the conversation on it, and
this tool does not show conversations.

```tsx
//| id: frontend-view-pull-header
//| file: src/frontend/views/PullHeader.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullHeader({ pull }: { pull: PullSummary }) {
  return (
    <header
      style={{
        display: "flex",
        flex: "none",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        background: "#f0f0f0",
        borderBottom: "1px solid #ccc",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "#888" }}>#{pull.number}</span>
      <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {pull.title}
      </strong>
      <PullStateChip state={pull.state} />
      <span style={{ color: "#888" }}>base: {pull.baseRefName}</span>
      <span style={{ color: "#888" }}>{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "#0969da" }}
      >
        github
      </a>
    </header>
  );
}
```

### Pull request timeline

Every head the branch has had, oldest first, on one line. Both ends of the
comparison are marked on that line at the same time: the after end in blue, the
before end in amber. A dropdown per end would show one choice each and neither
in the context of the other.

A click moves the after end and a shift-click moves the before end. Shift-click
is not discoverable, so the hint next to the chips says so in words rather than
leaving a reader to find it.

A chip shows its version label, the short oid, and when the force push that
made it happened. The label is for the reader, and everything that asks the
backend for a state passes the oid.

Both ends can land on the same head, and the caption names which way it
happened rather than reading like a typo, "comparing v1 → v1". A pull
request nobody has force-pushed has one head and nothing yet to compare. A
reviewer who picks one chip twice on a longer timeline has asked a question
with an empty answer, which is a different thing to be told.

```tsx
//| id: frontend-view-pull-timeline
//| file: src/frontend/views/PullTimeline.tsx
import type { GitOid, PullHeadOrigin, PullVersion } from "../api";

const AFTER = "#0969da";
const BEFORE = "#bf8700";

export function PullTimeline({
  states,
  before,
  after,
  onPick,
}: {
  states: PullVersion[];
  before: GitOid;
  after: GitOid;
  onPick: (head: GitOid, end: "before" | "after") => void;
}) {
  return (
    <div
      style={{
        flex: "none",
        padding: "6px 10px",
        borderBottom: "1px solid #ccc",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 6,
          overflowX: "auto",
        }}
      >
        {states.map((state) => (
          <Chip
            key={state.head}
            caption={`v${state.version}`}
            detail={`${state.head.slice(0, 7)}  ${when(state.origin)}`}
            accent={accentFor(state.head, before, after)}
            onClick={(shift) => onPick(state.head, shift ? "before" : "after")}
          />
        ))}
      </div>
      <p style={{ margin: "6px 0 0", color: "#888" }}>
        {caption(states, before, after)} · click sets the after end, shift-click
        sets the before end
      </p>
    </div>
  );
}

/** The after end wins when one chip is both, since it is the one being read. */
function accentFor(head: GitOid, before: GitOid, after: GitOid): string | null {
  if (head === after) return AFTER;
  if (head === before) return BEFORE;
  return null;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") return origin.at.slice(0, 10);
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(states: PullVersion[], before: GitOid, after: GitOid): string {
  if (before !== after) {
    return `comparing ${label(states, before)} → ${label(states, after)}`;
  }
  return states.length === 1
    ? `${label(states, after)} is the only version so far`
    : `${label(states, after)} against itself`;
}

function Chip({
  caption,
  detail,
  accent,
  onClick,
}: {
  caption: string;
  detail: string;
  accent: string | null;
  onClick: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.shiftKey)}
      style={{
        flex: "none",
        padding: "3px 8px",
        border: `1px solid ${accent ?? "#ccc"}`,
        borderRadius: 3,
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        color: accent ?? "inherit",
        background: accent === null ? "#fff" : "#f4f8ff",
      }}
    >
      <span style={{ display: "block", fontWeight: "bold" }}>{caption}</span>
      <span style={{ display: "block", color: "#888", fontSize: 11 }}>
        {detail}
      </span>
    </button>
  );
}
```

### Pull request panes

Two layouts, because the pull request screen nests. The outer one is the list
against everything else. The inner one stacks the header and the timeline over
a narrow commit strip and the diff, which is the part being read and so gets
the room.

```tsx
//| id: frontend-view-pull-panes
//| file: src/frontend/views/PullPanes.tsx
import type { ReactNode } from "react";

export function PullPanes({
  list,
  review,
}: {
  list: ReactNode;
  review: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <div
        style={{
          width: "22%",
          minWidth: 220,
          flex: "none",
          overflow: "auto",
          borderRight: "1px solid #ccc",
        }}
      >
        {list}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
        }}
      >
        {review}
      </div>
    </div>
  );
}

export function PullReviewPanes({
  header,
  timeline,
  commits,
  diff,
}: {
  header: ReactNode;
  timeline: ReactNode;
  commits: ReactNode;
  diff: ReactNode;
}) {
  return (
    <>
      {header}
      {timeline}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 260,
            flex: "none",
            overflow: "auto",
            borderRight: "1px solid #ccc",
          }}
        >
          {commits}
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{diff}</div>
      </div>
    </>
  );
}
```

## Controllers

### Operation log

```tsx
//| id: frontend-controller-operation-log
//| file: src/frontend/controllers/OperationLog.tsx
import { useOperations } from "../state/operations";
import { Message } from "../views/Message";
import { OperationPicker } from "../views/OperationPicker";

export function OperationLog({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  const operations = useOperations();

  if (operations.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (operations.status === "error") {
    return <Message tone="error">{operations.message}</Message>;
  }

  return (
    <OperationPicker
      operations={operations.data}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
```

### Commit log

```tsx
//| id: frontend-controller-commit-log
//| file: src/frontend/controllers/CommitLog.tsx
import type { Source } from "../api";
import { useCommits } from "../state/commits";
import { CommitGraph } from "../views/CommitGraph";
import { Message } from "../views/Message";

export function CommitLog({
  source,
  selected,
  onSelect,
}: {
  source: Source;
  selected: string[];
  onSelect?: ((commitIds: string[]) => void) | undefined;
}) {
  const log = useCommits(source);

  if (log.status === "loading") return <Message>Loading commits...</Message>;
  if (log.status === "error") {
    return <Message tone="error">{log.message}</Message>;
  }

  return (
    <CommitGraph commits={log.data} selected={selected} onSelect={onSelect} />
  );
}
```

### Diff pane

The diff panel's contents follow from what was asked. A comparison of local
commits comes back as one row per lined-up pair, and each row needs its own
header saying which commit faced which. A comparison of pull request heads
comes back as one patch, and the two versions it compares are already named on
the timeline above it, so a second header there would be a repetition.

Choosing between the two shapes happens here and nowhere else, which is what
keeps `DiffView` at "render these files".

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx
import { type Comparison, useComparison } from "../state/comparison";
import { DiffView } from "../views/DiffView";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({ comparison }: { comparison: Comparison }) {
  const answer = useComparison(comparison);

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }
  if (answer.data.kind === "jj") {
    return <InterdiffRows rows={answer.data.rows} />;
  }
  if (answer.data.files.length === 0) {
    return <Message>These two versions make the same change.</Message>;
  }

  return <DiffView files={answer.data.files} />;
}
```

### Pull requests

The list, and whichever pull request is picked out of it. The selected number
lives here rather than in `App` because the list is the only other thing that
reads it, and the summary it selects is what the header needs.

`PullReview` is keyed by the pull request number, so picking a different one
remounts it and the two ends of the comparison start again at "the first head
against the latest". Clearing them by hand would be the same behaviour written
out, with a way to forget a field.

```tsx
//| id: frontend-controller-pull-requests
//| file: src/frontend/controllers/PullRequests.tsx
import { useState } from "react";
import { usePulls } from "../state/pulls";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

export function PullRequests({ repo }: { repo: string }) {
  const pulls = usePulls(repo);
  const [selected, setSelected] = useState<number | null>(null);

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const pull = pulls.data.find((candidate) => candidate.number === selected);

  return (
    <PullPanes
      list={
        <PullList
          pulls={pulls.data}
          selected={selected}
          onSelect={setSelected}
        />
      }
      review={
        pull === undefined ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview key={pull.number} repo={repo} pull={pull} />
        )
      }
    />
  );
}
```

### Pull review

One pull request, head by head. The two ends of the comparison live here: the
after end defaults to the latest head and the before end to the first, so a
pull request opens on the interdiff across its whole force-push history, v1
to latest, and a shift-click narrows it to what changed since one particular
head.

```tsx
//| id: frontend-controller-pull-review
//| file: src/frontend/controllers/PullReview.tsx
import { useState } from "react";
import type { GitOid, PullSummary } from "../api";
import { usePullHistory } from "../state/pullHistory";
import { Message } from "../views/Message";
import { PullHeader } from "../views/PullHeader";
import { PullReviewPanes } from "../views/PullPanes";
import { PullTimeline } from "../views/PullTimeline";
import { CommitLog } from "./CommitLog";
import { DiffPane } from "./DiffPane";

export function PullReview({
  repo,
  pull,
}: {
  repo: string;
  pull: PullSummary;
}) {
  const history = usePullHistory(repo, pull.number);
  const [before, setBefore] = useState<GitOid | null>(null);
  const [after, setAfter] = useState<GitOid | null>(null);

  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  const states = history.data.states;
  const first = states[0];
  const latest = states.at(-1);
  if (first === undefined || latest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const from = before ?? first.head;
  const to = after ?? latest.head;
  const number = pull.number;

  return (
    <PullReviewPanes
      header={<PullHeader pull={pull} />}
      timeline={
        <PullTimeline
          states={states}
          before={from}
          after={to}
          onPick={(head, end) =>
            (end === "before" ? setBefore : setAfter)(head)
          }
        />
      }
      commits={
        <CommitLog
          source={{ kind: "pull", repo, number, head: to }}
          selected={[]}
        />
      }
      diff={<DiffPane comparison={{ kind: "pull", repo, number, from, to }} />}
    />
  );
}
```

## App

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { OperationLog } from "./controllers/OperationLog";
import { PullRequests } from "./controllers/PullRequests";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { ReviewPanes } from "./views/ReviewPanes";

/** The repository the pull request screen reads. Next up for configuring. */
const REPO = "glencbz/diffy";

export function App() {
  const [mode, setMode] = useState<Mode>("local");
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <ModeTabs mode={mode} onSelect={setMode} />
      {mode === "local" ? (
        <ReviewPanes
          before={<SidePicker side={before} />}
          after={<SidePicker side={after} />}
          diff={
            <DiffPane
              comparison={{
                kind: "jj",
                from: before.commits,
                to: after.commits,
              }}
            />
          }
        />
      ) : (
        <PullRequests repo={REPO} />
      )}
    </div>
  );
}

interface Side<S extends Source> {
  /** Where this side's commits come from. */
  source: S;
  /** Commit ids selected on this side, in log order. */
  commits: string[];
  selectSource: (source: S) => void;
  selectCommits: (commitIds: string[]) => void;
}

function useSide<S extends Source>(initial: S): Side<S> {
  const [source, setSource] = useState<S>(initial);
  const [commits, setCommits] = useState<string[]>([]);

  return {
    source,
    commits,
    selectSource(next) {
      setSource(next);
      setCommits([]);
    },
    selectCommits: setCommits,
  };
}

function SidePicker({ side }: { side: Side<JjSource> }) {
  return (
    <>
      <OperationLog
        selected={side.source.operation}
        onSelect={(operation) => side.selectSource({ kind: "jj", operation })}
      />
      <CommitLog
        source={side.source}
        selected={side.commits}
        onSelect={side.selectCommits}
      />
    </>
  );
}
```
