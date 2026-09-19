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
- `views/` imports React, other `views/`, and *types* from `api.ts` and
  `state/`. A view is written against a view model, `ReviewedRow` or
  `RowReview`, as often as against a wire type, and a type-only import erases
  at compile time, so pulling one in from `state/` adds no runtime coupling to
  fetch or React state. The line is drawn at values, not at where a name is
  declared, so importing a *function* from `state/` is the boundary
  violation.
- `controllers/` import `state/`, `views/`, and `api.ts` *types*.
- `App.tsx` imports `controllers/`, `views/`, and `api.ts` *types*.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack).
Bun's bundler finds the `<script>` and `<link>` tags and bundles them, along
with the React and JSX they pull in. `Bun.serve()` returns the bundle from `/`.
The `<link>` is how the [design system](design-system.md) reaches the page;
every class the views below name is defined there.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Diffy</title>
    <link rel="stylesheet" href="./styles.css" />
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

A git commit has no change id, and `commitsFrom` leaves the field null rather
than filling it with the commit id. A row names both ids, so a commit id
standing in for a change id would print twice, and the two are not
interchangeable: a change id survives an amend and a commit id does not. The
row falls back to the short oid on its own, which is how GitHub names the same
commit on the same screen, and `reviewKey` reads the null as its cue to key a
mark by revision.

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
    changeId: null,
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
        changeId: null,
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

### Review state

`/api/interdiff` must never learn that review state exists. Every row it
returns costs a `jj` process, so a mark that triggered a refetch would spawn a
subprocess to record a click. The session document is read from
[`localStorage`](#session) on its own, independently of the interdiff fetch;
whichever row a mark or comment belongs to is worked out here, client-side,
from ids both already carry.

`reviewKey` picks `row.to ?? row.from`: the after side is the version being
approved, so when a row has a real after side that commit is the one whose
identity counts. `alignSeries` guarantees at least one side is present, so
only a row with neither side throws.

That commit's own id, not the row's, decides the key's shape: `change:${id}`
when it carries a jj change id, `rev:${id}` on its commit id when it does not.
A jj change id and a git commit id are drawn from different id spaces and
could collide as bare strings, so the prefix keeps a `change:` key and a
`rev:` key apart in the one `change_id` column a mark or comment is stored
under, with no schema change needed to say so.

The two kinds of key degrade differently. A change id survives an amend, so a
`change:` key still finds its row after the commit is rewritten, and
`reviewed` still reads `reviewed`. A `rev:` key names one exact revision, so
rewriting the commit it was built from changes the key outright and the row
reads `unseen`, never `reviewed`, because nothing durable was ever true about
that identity. That loses memory, but safely: a `rev:`-keyed row can never
falsely claim to have been reviewed. It stays useful in the one case that does
not require surviving a rewrite. If the identifying commit is untouched but
the other side of the comparison moves, the key is unchanged, the stored
triple no longer matches, and the row correctly reads `changed`.

A mark is identified by the full `(reviewKey, fromCommitId, toCommitId)`
triple, not by the review key alone. `alignSeries` can put one change id on
two rows in the same series, because a reorder is a drop and an insert of the
same change and both halves identify off the same surviving commit, so a mark
on one must not paint the other as reviewed or even as changed. They are
different comparisons that share an identity only by coincidence of the
algorithm. Reading takes the same care writing does: `reviewed` needs an exact
triple match, and `changed` needs more than a shared review key, or the same
bug resurfaces one layer up.

A mark counts toward `changed` when it fills the same sides as the row, or
when it shares one: the same `fromCommitId` because an amend moved the after
side, or the same `toCommitId` because a rebase moved the before side. Sharing
a side alone is not enough, because a rebase that rewrites both sides at once
shares neither, and reporting a change the reader has already looked at as
`unseen` loses the memory the session exists to keep. Filling the same sides
alone is not enough either, because a change that was a modification and is
now a drop fills different slots while being the same thing the reader
reviewed. The two together leave exactly one pair unrelated, which is the pair
that has to be: the drop half of a reorder (`from: A, to: null`) and its
insert half (`from: null, to: A`) neither share a side nor fill the same
slots, so a mark on one leaves the other `unseen`. The insert is a comparison
the reader has never looked at.

A comment's `stale` flag asks whether one line still means what it meant when
the note was written, a narrower question than a mark's `changed` state. A
comment's `commitId` names the version its line number was read against, and
it is stale when neither of the row's current sides is that commit.

```ts
//| id: frontend-state-review
//| file: src/frontend/state/review.ts
import * as z from "zod";
import type { InterdiffRow } from "../api";

const Comparison = z.object({
  reviewKey: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Comment = z.object({
  id: z.string(),
  reviewKey: z.string(),
  path: z.string(),
  line: z.number().int(),
  commitId: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const SessionDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
});
export type SessionDocument = z.infer<typeof SessionDocument>;

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

export interface RowComment extends Comment {
  stale: boolean;
}

export interface ReviewedRow extends InterdiffRow {
  reviewKey: string;
  review: RowReview;
  comments: RowComment[];
}

/** What a mark uses to find its row again. A change id survives a rewrite, so
 *  a mark under one is still recognisable after the commit is amended. A
 *  backend with no change ids can only name an exact revision, so a rewrite
 *  yields a different key and the row reads as unseen, never as reviewed. */
export function reviewKey(row: InterdiffRow): string {
  const commit = row.to ?? row.from;
  if (commit === null) {
    throw new Error("interdiff row has no commit on either side");
  }
  return commit.changeId !== null
    ? `change:${commit.changeId}`
    : `rev:${commit.commitId}`;
}

function latestMark(marks: Mark[]): Mark | null {
  return marks.reduce<Mark | null>(
    (latest, mark) =>
      latest === null || mark.seenAt > latest.seenAt ? mark : latest,
    null,
  );
}

/** Whether a mark describes the same comparison slot: both sides, or which
 * single side, the row fills. A reorder's drop and insert halves fill
 * opposite slots, so neither can speak for the other. */
function fillsSameSides(
  mark: Mark,
  fromCommitId: string | null,
  toCommitId: string | null,
): boolean {
  return (
    (mark.fromCommitId === null) === (fromCommitId === null) &&
    (mark.toCommitId === null) === (toCommitId === null)
  );
}

function reviewFor(
  marksForChange: Mark[],
  fromCommitId: string | null,
  toCommitId: string | null,
): RowReview {
  const exact = marksForChange.find(
    (mark) =>
      mark.fromCommitId === fromCommitId && mark.toCommitId === toCommitId,
  );
  if (exact !== undefined) return { state: "reviewed", seenAt: exact.seenAt };

  const related = marksForChange.filter(
    (mark) =>
      fillsSameSides(mark, fromCommitId, toCommitId) ||
      mark.fromCommitId === fromCommitId ||
      mark.toCommitId === toCommitId,
  );
  const latest = latestMark(related);
  if (latest === null) return { state: "unseen" };
  return {
    state: "changed",
    seenAt: latest.seenAt,
    seenFrom: latest.fromCommitId,
    seenTo: latest.toCommitId,
  };
}

export function reviewRows(
  rows: InterdiffRow[],
  document: SessionDocument,
): ReviewedRow[] {
  return rows.map((row) => {
    const key = reviewKey(row);
    const fromCommitId = row.from?.commitId ?? null;
    const toCommitId = row.to?.commitId ?? null;
    const marksForChange = document.marks.filter(
      (mark) => mark.reviewKey === key,
    );

    const comments = document.comments
      .filter((comment) => comment.reviewKey === key)
      .map((comment) => ({
        ...comment,
        stale:
          comment.commitId !== fromCommitId && comment.commitId !== toCommitId,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      ...row,
      reviewKey: key,
      review: reviewFor(marksForChange, fromCommitId, toCommitId),
      comments,
    };
  });
}

/** Whether two marks (or a mark and a comparison) name the same row: the
 * same change id filling the same before/after slots. Exported so the
 * session store can replace or remove a mark by the same key it is read
 * back by. */
export function sameComparison(
  a: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
  b: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
): boolean {
  return (
    a.reviewKey === b.reviewKey &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}
```

The reorder case runs `alignSeries` for real rather than using a hand-rolled
fixture. The bug this schema guards against is in how `alignSeries`'s output
becomes review state, and a fixture written by hand could encode the same
wrong assumption the code is being tested against.

```ts
//| id: frontend-state-review-test
//| file: src/frontend/state/review.test.ts
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow, LogEntry } from "../api";
import { reviewKey, reviewRows, type SessionDocument } from "./review";

function logEntry(changeId: string, commitId: string): LogEntry {
  return { changeId, commitId, description: "", parents: [] };
}

function gitLogEntry(commitId: string): LogEntry {
  return { changeId: null, commitId, description: "", parents: [] };
}

function pairRow(
  changeId: string,
  fromCommitId: string,
  toCommitId: string,
): InterdiffRow {
  return {
    from: logEntry(changeId, fromCommitId),
    to: logEntry(changeId, toCommitId),
    files: [],
  };
}

describe("reviewRows", () => {
  test("leaves a row unseen against an empty document", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = { marks: [], comments: [] };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a row reviewed on an exact triple match", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("marks a row changed when the after side has moved on", () => {
    // arrange
    const row = pairRow("a", "a1", "a3");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when the before side has moved on", () => {
    // arrange
    const row = pairRow("a", "a0", "a2");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when a rebase moved both sides at once", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("leaves the other half of a reorder unseen, not changed", () => {
    // arrange
    const A = logEntry("aaaa", "a1");
    const B = logEntry("bbbb", "b1");
    const rows = alignSeries([A, B], [B, A]).map((pair) => ({
      ...pair,
      files: [],
    }));
    const changeARows = reviewRows(rows, { marks: [], comments: [] }).filter(
      (row) => row.reviewKey === "change:aaaa",
    );
    const dropped = changeARows.find((row) => row.to === null);
    if (dropped === undefined) {
      throw new Error("expected a dropped row for change aaaa");
    }
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:aaaa",
          fromCommitId: dropped.from?.commitId ?? null,
          toCommitId: dropped.to?.commitId ?? null,
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const inserted = reviewRows(rows, document).find(
      (row) => row.reviewKey === "change:aaaa" && row.from === null,
    );

    // assert
    expect(rows).toHaveLength(3);
    expect(changeARows).toHaveLength(2);
    expect(inserted?.review).toEqual({ state: "unseen" });
  });

  test("flags a comment stale when its commit is on neither side of the row", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          path: "f.ts",
          line: 3,
          commitId: "a0",
          body: "old",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("derives unseen for a change-id-less row against an empty document", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = { marks: [], comments: [] };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a change-id-less row reviewed on an exact triple match", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("reads unseen, not reviewed or changed, once a change-id-less row's identifying commit is rewritten", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2-rewritten"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a change-id-less row changed when the other side has moved on", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1-new"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "g1",
      seenTo: "g2",
    });
  });
});

describe("reviewKey", () => {
  test("keeps a jj row and a git row apart even when the literal id matches", () => {
    // arrange
    const jjRow: InterdiffRow = {
      from: null,
      to: logEntry("shared", "c1"),
      files: [],
    };
    const gitRow: InterdiffRow = {
      from: null,
      to: gitLogEntry("shared"),
      files: [],
    };

    // act
    const jjKey = reviewKey(jjRow);
    const gitKey = reviewKey(gitRow);

    // assert
    expect(jjKey).toBe("change:shared");
    expect(gitKey).toBe("rev:shared");
    expect(jjKey).not.toBe(gitKey);
  });
});
```

### Session

The session belongs to whoever is reading, not to the repository being read,
so it lives in the browser. It used to live in a SQLite file under `.jj/`,
which put diffy's own bookkeeping inside the directory of the tool being
reviewed. `.jj/` is jj's. A reviewer's marks and comments are diffy's
business, and a database only jj is supposed to manage sitting in that
directory was a surprise waiting to happen, whatever the file format. A
different path on the server would not have fixed that.

`window.localStorage` replaces it: built into every browser, no dependency to
add, and synchronous. `IndexedDB` was the other browser-native option and
loses on that last point. A `fetch` needs a loading state; a synchronous read
does not, because the data is there by the time a component first renders. A
`fetch` needs an optimistic update held apart from server truth until a
response confirms it; a synchronous write has no "in flight" to be optimistic
about. A `fetch` needs a failure path that reconciles a rejected write against
whatever the server ended up holding; a synchronous write either succeeds or
throws where it is called. All three collapse into a plain `useState`, because
all three only existed to cover a round trip that is now gone.

The session follows the browser rather than the repo, and that costs
something. It does not survive clearing site data. It is not shared between
two browsers, or between two machines working from the same clone. Because
[`just serve` gives each workspace its own port](../devtools/serving.md),
browser storage is partitioned by origin, and an origin includes the port, two
workspaces of the same repo reviewed side by side get two separate sessions,
which is usually what is wanted. A different repo served later on a port an
earlier repo used inherits that repo's stored marks. Those marks carry change
ids no row in the new repo will ever match, so they render as nothing, but
they accumulate in `localStorage`. That is accepted on the same "good enough
for one reader in one browser" grounds as the rest of this design. A reviewer
working from two machines, or a session that has to outlive clearing browser
data, wants a server-side store keyed by repo, which is a feature to build
rather than a small addition to this one.

`SessionEdit` is gone along with the database. It existed so one edit value
could be applied to a local copy and posted verbatim, letting the client's
`applyEdit` and the backend's `applyEdit` compute the same document from the
same input without being reconciled. That argument needs two implementations
that could disagree. With no server there is one mutation and one place it
runs, so `SessionEdit` had stopped describing a mutation and become a dispatch
layer between a mutator that knew what it wanted to do and a `switch` that
re-derived the same thing from a `kind` field. The union and `applyEdit` are
gone, and each mutator below builds the next document directly.

`useSession` reads the stored document once, lazily, as the initial value of a
single `useState<SessionDocument>`. It passes `useState(load)` rather than
`useState(load())`, so the read happens once rather than racing every render.
`load` parses whatever sits under the storage key with the `SessionDocument`
Zod schema and falls back to an empty document on anything that does not
parse: absent, truncated by a full quota, or hand-edited in devtools into some
other shape. Content read out of `localStorage` is external input the way a
request body was, so it gets the boundary discipline a request body used to
get on the server. A corrupt blob costs the reviewer their history, not the
ability to open the app.

`save` writes back through a `try`/`catch` that swallows a thrown write.
`localStorage.setItem` throws in Safari private browsing and whenever a tab is
over quota, and there is no error channel here to carry that failure anywhere.
The caller is a synchronous state update from inside a click handler, not a
promise with a `.catch` to hang one off. A session that keeps working for the
rest of the tab, without surviving a reload, beats throwing out of that click.
`Session` has no `error` field, because a persistence failure the reviewer
cannot act on is not worth a UI state.

Each mutator computes its next document from the current one and hands it to
`update`, the one place that writes to `localStorage` and calls `setDocument`.
This is the same five-way logic that used to live in `applyEdit`'s `switch`,
inlined at the call site that already knows which mutation it is making rather
than re-derived from a `kind` tag a layer away. `markSeen` decides mark versus
unmark from the row's own `review.state`, so callers never build a comparison
by hand. Every mutator is wrapped in `useCallback` closing only over the
stable `update` function rather than over `document`, so passing `markSeen`
through two layers of props does not retrigger effects that depend on it.

```tsx
//| id: frontend-state-session
//| file: src/frontend/state/session.ts
import { useCallback, useState } from "react";
import {
  type Comment,
  type ReviewedRow,
  SessionDocument,
  sameComparison,
} from "./review";

const STORAGE_KEY = "diffy.session.v1";
const EMPTY_DOCUMENT: SessionDocument = { marks: [], comments: [] };

/** localStorage content is written by a possibly older version of this
 * app, or by hand in devtools; treat it as untrusted input and fall back
 * to an empty session rather than let a bad blob break the app. */
export function load(): SessionDocument {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return EMPTY_DOCUMENT;

  try {
    return SessionDocument.parse(JSON.parse(raw));
  } catch {
    return EMPTY_DOCUMENT;
  }
}

/** setItem throws in Safari private browsing and over quota; there is no
 * error channel from here back to a click handler, and a session that
 * keeps working for the tab without persisting beats one that throws. */
export function save(document: SessionDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // See the doc comment: persistence failure is not worth a UI state.
  }
}

export interface Session {
  document: SessionDocument;
  markSeen: (row: ReviewedRow) => void;
  addComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
}

export function useSession(): Session {
  const [document, setDocument] = useState<SessionDocument>(load);

  const update = useCallback(
    (compute: (current: SessionDocument) => SessionDocument) => {
      setDocument((current) => {
        const next = compute(current);
        save(next);
        return next;
      });
    },
    [],
  );

  const markSeen = useCallback(
    (row: ReviewedRow) => {
      const comparison = {
        reviewKey: row.reviewKey,
        fromCommitId: row.from?.commitId ?? null,
        toCommitId: row.to?.commitId ?? null,
      };
      update((current) => {
        const marks = current.marks.filter(
          (mark) => !sameComparison(mark, comparison),
        );
        if (row.review.state === "reviewed") return { ...current, marks };
        return {
          ...current,
          marks: [
            ...marks,
            { ...comparison, seenAt: new Date().toISOString() },
          ],
        };
      });
    },
    [update],
  );

  const addComment = useCallback(
    (row: ReviewedRow, path: string, line: number, body: string) => {
      const comment: Comment = {
        id: crypto.randomUUID(),
        reviewKey: row.reviewKey,
        path,
        line,
        commitId: row.to?.commitId ?? row.from?.commitId ?? "",
        body,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      update((current) => ({
        ...current,
        comments: [...current.comments, comment],
      }));
    },
    [update],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) => {
      update((current) => ({
        ...current,
        comments: current.comments.map((comment) =>
          comment.id === id ? { ...comment, resolved } : comment,
        ),
      }));
    },
    [update],
  );

  const dropComment = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== id),
      }));
    },
    [update],
  );

  return { document, markSeen, addComment, resolveComment, dropComment };
}
```

The store's own tests live next to it, with an in-memory `localStorage`
stand-in, since `bun test` has no DOM to provide the real thing. `load` and
`save` are exported by name rather than kept private to the hook so those
tests can reach them without rendering a component. This project has no
renderer, and adding one to cover a `try`/`catch` would cost more than the two
functions it tests.

```ts
//| id: frontend-state-session-test
//| file: src/frontend/state/session.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionDocument } from "./review";
import { load, save } from "./session";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

describe("load", () => {
  test("round-trips a document through save", () => {
    // arrange
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    save(document);

    // assert
    expect(load()).toEqual(document);
  });

  test("loads an empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", "not json");

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });
});

describe("save", () => {
  test("does not throw when the store throws", () => {
    // arrange
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;

    // act
    // assert
    expect(() => save({ marks: [], comments: [] })).not.toThrow();
  });
});
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
    <div className="panes">
      <PickerColumn caption="before">{before}</PickerColumn>
      <PickerColumn caption="after">{after}</PickerColumn>
      <div className="pane pane--diff">{diff}</div>
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
    <div className="pane pane--picker">
      <h2 className="pane__header">{caption}</h2>
      <div className="pane__body">{children}</div>
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
    <p className={tone === "error" ? "message message--error" : "message"}>
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
    <label className="operation-picker">
      <span className="operation-picker__label">operation</span>
      <select
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        className="operation-picker__select"
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
        className={
          commit.changeId !== null
            ? "commit-label__id"
            : "commit-label__id commit-label__id--synthetic"
        }
      >
        {shortId}
      </span>
      <span className="commit-label__summary">
        {summary || (
          <em className="commit-label__placeholder">(no description)</em>
        )}
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

A third line adds review state to that same job: whether the row has been
looked at, whether it moved since, and how many open comments sit on it. The
`mark seen` / `mark unseen` button reads its own label off
`row.review.state`, so the caller wires the click through without computing
which action is current.

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { ReactNode } from "react";
import type { LogEntry } from "../api";
import type { ReviewedRow, RowReview } from "../state/review";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  row,
  onMarkSeen,
}: {
  row: ReviewedRow;
  onMarkSeen: () => void;
}) {
  const openComments = row.comments.filter(
    (comment) => !comment.resolved,
  ).length;

  return (
    <header className="comparison-header">
      <Row caption="before" commit={row.from} />
      <Row caption="after" commit={row.to} />
      <div className="comparison-header__actions">
        <ReviewChip review={row.review} />
        {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
        <button
          type="button"
          onClick={onMarkSeen}
          className="comparison-header__mark-seen"
        >
          {row.review.state === "reviewed" ? "mark unseen" : "mark seen"}
        </button>
      </div>
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
    <div className="comparison-header__row">
      <span className="comparison-header__caption">{caption}</span>
      {commit === null ? (
        <em className="comparison-header__unavailable">not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}

function ReviewChip({ review }: { review: RowReview }) {
  if (review.state === "unseen") return null;
  return review.state === "reviewed" ? (
    <Chip tone="reviewed">reviewed</Chip>
  ) : (
    <Chip tone="changed">changed since you looked</Chip>
  );
}

const TONE_CLASS: Record<"reviewed" | "changed" | "open", string> = {
  reviewed: "review-chip--resolved",
  changed: "review-chip--stale",
  open: "review-chip--open",
};

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  return <span className={`review-chip ${TONE_CLASS[tone]}`}>{children}</span>;
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
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;
const LANE_CLASS_COUNT = 7;

// Lane zero stays grey, so a linear history is unchanged; branches get colour.
function laneClass(lane: number): string {
  return `commit-graph__lane--${lane % LANE_CLASS_COUNT}`;
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
        const className = `commit-graph__row${
          chosen.has(commit.commitId) ? " commit-graph__row--selected" : ""
        }`;
        const content = (
          <>
            <RowGraphic row={row} width={gutterWidth} />
            <CommitLabel commit={commit} />
          </>
        );

        return onSelect === undefined ? (
          <div key={commit.commitId} className={className}>
            {content}
          </div>
        ) : (
          <button
            type="button"
            key={commit.commitId}
            onClick={() => toggle(commit.commitId, onSelect)}
            className={`${className} commit-graph__row--interactive`}
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
      className="commit-graph__gutter"
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={0}
          x2={x(edge.to)}
          y2={middle}
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={middle}
          x2={x(edge.to)}
          y2={ROW_HEIGHT}
          className={`commit-graph__edge ${laneClass(edge.to)}`}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={middle}
        r={4}
        className={`commit-graph__node ${laneClass(row.lane)}${
          row.isMerge ? " commit-graph__node--merge" : ""
        }`}
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

Rows take `ReviewedRow` now, not the bare wire `InterdiffRow`, and thread the
four session callbacks down to `ComparisonHeader` and `DiffView`. `rowKey`
stays keyed on commit ids as before. [A reordered series can put the same
change id on two rows](#review-state), so the change id is not a unique React
key even though it now sits on the row.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import type { ReviewedRow } from "../state/review";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  onMarkSeen,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  rows: ReviewedRow[];
  onMarkSeen: (row: ReviewedRow) => void;
  onAddComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader row={row} onMarkSeen={() => onMarkSeen(row)} />
          {row.files.length === 0 ? (
            <p className="interdiff-empty">
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView
              files={row.files}
              review={{
                comments: row.comments,
                onAddComment: (path, line, body) =>
                  onAddComment(row, path, line, body),
                onResolveComment,
                onDropComment,
              }}
            />
          )}
        </section>
      ))}
    </div>
  );
}

function rowKey(row: ReviewedRow): string {
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

A left gutter adds the after-side line number to each rendered line, because
that is what a comment's `line` field means: the line as it reads in the
version being approved, not an offset into the raw patch text. `gutterLines`
walks the patch once and carries a running counter, seeded by each `@@
-a,b +c,d @@` header's `c`. `diff --git`, `index `, `---`, `+++`, and hunk
header lines never had an after-side line, and a `-` line was removed, so it
has none either. Both show a blank gutter and are not clickable, because there
is nothing on that line in the version a comment would be anchored to.

Clicking a commentable line opens a composer for it, a plain `<form>` with one
`useState<{path, line} | null>` for which line's composer is open, closed again
on submit or cancel. Comment threads render under the file's `<pre>` rather
than in the gutter. A gutter-anchored thread would have to reflow around
variable-height content on every keystroke, and the patch is already read top
to bottom, so a comment reads as the next thing under the line it is about. A
thread whose `commitId` matches neither side of the row says it is stale in
place, because the line number next to it may no longer be the line the
comment was written about.

All of that hangs off one optional `DiffReview` rather than four optional
props, which could not be supplied half-filled. A diff either carries review
memory or it does not, and a diff without it offers no commentable line, so a
read-only diff cannot advertise an affordance that records nothing.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import { useState } from "react";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";

/** Review memory for the files on screen. A diff that has one lets every
 * after-side line be commented on; a diff that has none renders read-only. */
export interface DiffReview {
  comments: RowComment[];
  onAddComment: (path: string, line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}

export function DiffView({
  files,
  review,
}: {
  files: FileDiff[];
  review?: DiffReview;
}) {
  const [composer, setComposer] = useState<{
    path: string;
    line: number;
  } | null>(null);

  return (
    <div className="diff-view">
      {files.map((file) => {
        const path = pathOf(file);
        return (
          <FileRow
            key={path}
            file={file}
            review={
              review === undefined
                ? undefined
                : {
                    comments: review.comments.filter(
                      (comment) => comment.path === path,
                    ),
                    composerLine:
                      composer?.path === path ? composer.line : null,
                    onOpenComposer: (line) => setComposer({ path, line }),
                    onCancelComposer: () => setComposer(null),
                    onSubmitComposer: (line, body) => {
                      review.onAddComment(path, line, body);
                      setComposer(null);
                    },
                    onResolveComment: review.onResolveComment,
                    onDropComment: review.onDropComment,
                  }
            }
          />
        );
      })}
    </div>
  );
}

/** `DiffReview` narrowed to one file, with the composer this view owns. */
interface FileReview {
  comments: RowComment[];
  composerLine: number | null;
  onOpenComposer: (line: number) => void;
  onCancelComposer: () => void;
  onSubmitComposer: (line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}

function FileRow({ file, review }: { file: FileDiff; review?: FileReview }) {
  return (
    <section className="diff-file">
      <header className="diff-file__header">
        <span className="diff-file__status">{file.status}</span>
        {pathOf(file)}
      </header>
      {file.binary ? (
        <p className="diff-file__binary">Binary file, no textual diff.</p>
      ) : (
        <pre className="diff-file__patch">
          {gutterLines(file.patch).map(({ text, afterLine }, index) => (
            <PatchLine
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
              key={index}
              text={text}
              afterLine={afterLine}
              onOpenComposer={review?.onOpenComposer}
            />
          ))}
        </pre>
      )}
      {review !== undefined && review.composerLine !== null && (
        <CommentComposer
          line={review.composerLine}
          onCancel={review.onCancelComposer}
          onSubmit={review.onSubmitComposer}
        />
      )}
      {review !== undefined && review.comments.length > 0 && (
        <div>
          {review.comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              onResolve={(resolved) =>
                review.onResolveComment(comment.id, resolved)
              }
              onDrop={() => review.onDropComment(comment.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CommentComposer({
  line,
  onCancel,
  onSubmit,
}: {
  line: number;
  onCancel: () => void;
  onSubmit: (line: number, body: string) => void;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSubmit(line, body);
      }}
    >
      <div className="comment-composer__line">line {line}</div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="comment-composer__input"
      />
      <div className="comment-composer__actions">
        <button type="submit">comment</button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

function CommentThread({
  comment,
  onResolve,
  onDrop,
}: {
  comment: RowComment;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={
        comment.resolved
          ? "comment-thread comment-thread--resolved"
          : "comment-thread"
      }
    >
      <div className="comment-thread__meta">
        <span>
          {comment.path}:{comment.line} ·{" "}
          {comment.resolved ? "resolved" : "open"}
        </span>
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        <button type="button" onClick={onDrop}>
          delete
        </button>
      </div>
      <div>{comment.body}</div>
      {comment.stale && (
        <div className="comment-thread__stale">
          written against {comment.commitId.slice(0, 8)}. That line has since
          been rewritten.
        </div>
      )}
    </div>
  );
}

/** A `<button>` when the line has an after-side line to comment on, a `<div>`
 *  otherwise. A read-only diff passes no `onOpenComposer`, which makes every
 *  line static. */
function PatchLine({
  text,
  afterLine,
  onOpenComposer,
}: {
  text: string;
  afterLine: number | null;
  onOpenComposer?: (line: number) => void;
}) {
  const kind = lineKind(text);
  const body = (
    <>
      <span className="diff-line__gutter">{afterLine ?? ""}</span>
      <span className={kind === null ? undefined : `diff-line__text--${kind}`}>
        {text === "" ? " " : text}
      </span>
    </>
  );

  if (afterLine === null || onOpenComposer === undefined) {
    return <div className="diff-line">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(afterLine)}
      className="diff-line diff-line--interactive"
    >
      {body}
    </button>
  );
}

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

type DiffLineKind = "meta" | "hunk" | "added" | "removed";

function lineKind(line: string): DiffLineKind | null {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "meta";
  if (line.startsWith("diff --git ") || line.startsWith("index "))
    return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return null;
}

interface GutterLine {
  text: string;
  afterLine: number | null;
}

/** After-side line number per rendered patch line, or null where none applies. */
function gutterLines(patch: string): GutterLine[] {
  let afterLine: number | null = null;

  return patch.split("\n").map((text) => {
    if (
      text === "" ||
      text.startsWith("diff --git ") ||
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { text, afterLine: null };
    }

    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      afterLine = Number(hunk[1]);
      return { text, afterLine: null };
    }

    if (text.startsWith("-")) return { text, afterLine: null };

    if (afterLine === null) return { text, afterLine: null };
    const line = afterLine;
    afterLine += 1;
    return { text, afterLine: line };
  });
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
    <nav className="tabs">
      {(Object.keys(CAPTIONS) as Mode[]).map((candidate) => (
        <button
          type="button"
          key={candidate}
          onClick={() => onSelect(candidate)}
          className={candidate === mode ? "tab tab--current" : "tab"}
          aria-current={candidate === mode}
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

const CHIP_CLASS: Record<PullState, string> = {
  OPEN: "chip--open",
  MERGED: "chip--merged",
  CLOSED: "chip--closed",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span className={`chip ${CHIP_CLASS[state]}`}>{state.toLowerCase()}</span>
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
          className={
            pull.number === selected
              ? "pull-list__item pull-list__item--selected"
              : "pull-list__item"
          }
        >
          <span className="pull-list__row">
            <span className="pull-list__number">#{pull.number}</span>
            <PullStateChip state={pull.state} />
          </span>
          <span className="pull-list__title">{pull.title}</span>
          <span className="pull-list__base">← {pull.baseRefName}</span>
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
    <header className="pull-header">
      <span className="pull-header__meta">#{pull.number}</span>
      <strong className="pull-header__title">{pull.title}</strong>
      <PullStateChip state={pull.state} />
      <span className="pull-header__meta">base: {pull.baseRefName}</span>
      <span className="pull-header__meta">{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        className="pull-header__link"
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

type Endpoint = "before" | "after";

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
    <div className="pull-timeline">
      <div className="pull-timeline__row">
        {states.map((state) => (
          <Chip
            key={state.head}
            caption={`v${state.version}`}
            detail={`${state.head.slice(0, 7)}  ${when(state.origin)}`}
            endpoint={endpointFor(state.head, before, after)}
            onClick={(shift) => onPick(state.head, shift ? "before" : "after")}
          />
        ))}
      </div>
      <p className="pull-timeline__caption">
        {caption(states, before, after)} · click sets the after end, shift-click
        sets the before end
      </p>
    </div>
  );
}

/** The after end wins when one chip is both, since it is the one being read. */
function endpointFor(
  head: GitOid,
  before: GitOid,
  after: GitOid,
): Endpoint | null {
  if (head === after) return "after";
  if (head === before) return "before";
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
  endpoint,
  onClick,
}: {
  caption: string;
  detail: string;
  endpoint: Endpoint | null;
  onClick: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.shiftKey)}
      className={
        endpoint === null ? "pull-chip" : `pull-chip pull-chip--${endpoint}`
      }
    >
      <span className="pull-chip__caption">{caption}</span>
      <span className="pull-chip__detail">{detail}</span>
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
    <div className="panes">
      <div className="pane pane--list">{list}</div>
      <div className="pane pane--main">{review}</div>
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
      <div className="panes">
        <div className="pane pane--commits">{commits}</div>
        <div className="pane pane--diff">{diff}</div>
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

Takes a `session` prop rather than calling `useSession` itself, since `App`
owns the one session for the whole page and other readers will want it. The
existing null/loading/error branches on the comparison fetch are untouched,
because a synchronous local store adds nothing to them. `reviewRows` runs
below those early returns as a plain function call, since it derives from
props already in hand rather than fetching.

Review memory reaches the jj branch alone. A mark and a comment are keyed by
the pair of commits a row lines up, and a pull request diff is one patch
between two heads with no such row, so it renders read-only until it is given
an identity of its own. Inventing one here would ship it untested behind a
conflict resolution.

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx
import { type Comparison, useComparison } from "../state/comparison";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { DiffView } from "../views/DiffView";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  session,
}: {
  comparison: Comparison;
  session: Session;
}) {
  const answer = useComparison(comparison);

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }
  if (answer.data.kind === "jj") {
    return (
      <InterdiffRows
        rows={reviewRows(answer.data.rows, session.document)}
        onMarkSeen={session.markSeen}
        onAddComment={session.addComment}
        onResolveComment={session.resolveComment}
        onDropComment={session.dropComment}
      />
    );
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
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

export function PullRequests({
  repo,
  session,
}: {
  repo: string;
  session: Session;
}) {
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
          <PullReview
            key={pull.number}
            repo={repo}
            pull={pull}
            session={session}
          />
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
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullHeader } from "../views/PullHeader";
import { PullReviewPanes } from "../views/PullPanes";
import { PullTimeline } from "../views/PullTimeline";
import { CommitLog } from "./CommitLog";
import { DiffPane } from "./DiffPane";

export function PullReview({
  repo,
  pull,
  session,
}: {
  repo: string;
  pull: PullSummary;
  session: Session;
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
      diff={
        <DiffPane
          comparison={{ kind: "pull", repo, number, from, to }}
          session={session}
        />
      }
    />
  );
}
```

## App

`App` calls `useSession()` once, alongside the two `useSide()` calls it
already owns, and passes it down to whichever `DiffPane` is on screen. One
session serves both screens, so a mark made on the local history is the same
record the pull request screen reads. `useSide` and
`SidePicker` are untouched. Wiring review state into the commit pickers would
mean threading it through `CommitLog` and `CommitGraph` too, for a graph that
shows nothing about review state and has no requested feature that would use
it.

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { OperationLog } from "./controllers/OperationLog";
import { PullRequests } from "./controllers/PullRequests";
import { useSession } from "./state/session";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { ReviewPanes } from "./views/ReviewPanes";

/** The repository the pull request screen reads. Next up for configuring. */
const REPO = "glencbz/diffy";

export function App() {
  const [mode, setMode] = useState<Mode>("local");
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });
  const session = useSession();

  return (
    <div className="app">
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
              session={session}
            />
          }
        />
      ) : (
        <PullRequests repo={REPO} session={session} />
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
