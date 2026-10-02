# Transport

`api.ts` is the only module that talks to the backend, and the only one that
knows a server exists.

`api.ts` has one Zod schema and one `fetch` wrapper per endpoint. The shapes
those schemas parse into are not the schemas' to declare. Each one is a plain
TypeScript type in `model/`, written out the way a reader wants to read it,
and the schemas stay private to `api.ts`. Every wrapper declares the model type
it returns, so the compiler checks what the schema parses against what the app
expects at the one place they meet. A field the schema drops or a value it
admits that the type does not is a type error in the wrapper.

The check runs one way. A schema stricter than its type, such as one that
accepts two of the three pull request states, still compiles, because what it
parses is still a valid value of the type. Asking for `z.infer` instead would
make the schema the source of truth, so every view would read a type nobody
wrote down and a change to a parser would quietly become a change to the
app's model.

`FileDiff` is a discriminated union on `status`. `added`, `deleted`, and `modified` carry
a single `path`. `renamed` and `copied` carry `oldPath` and `newPath`.

`LogEntry.changeId` is nullable because a GitHub pull request's commits are
plain git commits, and a git commit has no change id. The field stays
required, so a backend without one has to say `changeId: null`. Defaulting a
missing key to null reads as more forgiving and costs more than it gives. A
jj backend that stopped emitting `change_id` through a bug of its own would
parse cleanly, and every row would quietly lose its rewrite-stable identity
with nothing raised to say why. A missing field is a backend nobody taught
about this one, and it should fail at the boundary.
[`alignSeries`](../backend/series.md) has what pairing does without an id.

`LogEntry` carries the rest of what a log row shows: who wrote the commit,
when, the names pointing at it and the standings a backend reports about it.
`author` and `timestamp` are display strings whose precision is the backend's
to choose, because the two backends disagree on which one a reader wants. jj
prints an author's email and a committer's timestamp, and matching `jj log`
is the point; a GitHub pull request is read through git, which knows an
author's name and the date they wrote. `refs` and `markers` are empty for a
git commit, which has neither in this app.

`GitOid` is branded, so the only way to hold one is to have parsed it, out of a
backend response, the address, or what the browser stored. A head oid cannot be typed into the app
by hand, which is what makes the guarantee in the next section hold at compile
time. Its schema is the one that lives in `model/` beside its type, because the
schema is the only thing that mints one and `model/` parses oids of its own.

```ts
//| id: frontend-model-history
//| file: src/frontend/model/history.ts
import * as z from "zod";

/** A full 40-hex git object id. Branded: only a parse mints one. */
export type GitOid = string & z.$brand<"GitOid">;
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");

/** A name a backend prints beside a commit: see `CommitRef` in the jj module. */
export type CommitRef = {
  kind: "bookmark" | "tag" | "working-copy";
  name: string;
};

export type CommitMarker =
  | "working-copy"
  | "empty"
  | "conflict"
  | "divergent"
  | "hidden";

export type LogEntry = {
  commitId: string;
  changeId: string | null;
  description: string;
  parents: string[];
  /** Whoever the backend names as the author, as it names them. */
  author: string;
  /** ISO 8601. The instant the backend dates this commit by. */
  timestamp: string;
  refs: CommitRef[];
  markers: CommitMarker[];
};

export type OpLogEntry = {
  id: string;
  description: string;
  time: string;
  args: string;
};
```

```ts
//| id: frontend-model-diff
//| file: src/frontend/model/diff.ts
import type { LogEntry } from "./history";

/** A token difftastic says changed, in UTF-16 code units of its line. */
export type ChangedRange = { start: number; end: number };

export type StructuralLine =
  | { kind: "context"; code: string; newLine: number; oldLine?: number }
  | { kind: "removed"; code: string; oldLine: number; changes: ChangedRange[] }
  | { kind: "added"; code: string; newLine: number; changes: ChangedRange[] };

export type StructuralHunk = {
  header: string;
  newStart: number;
  oldStart: number;
  lines: StructuralLine[];
};

/** A file as [difftastic](../backend/difft.md) reads it: hunks in the same
 *  shape a patch reads into, with each changed line's ranges, or why the
 *  file has none. */
export type StructuralDiff =
  | { kind: "structural"; language: string; hunks: StructuralHunk[] }
  | { kind: "unavailable"; reason: string };

type FileDiffFields = {
  binary: boolean;
  /** The blob each side is stored under, for `fetchSource`. Null for a side
   *  that does not exist. */
  oldBlob: string | null;
  newBlob: string | null;
  patch: string;
  structural: StructuralDiff;
};

export type FileDiff = FileDiffFields &
  (
    | { status: "added" | "deleted" | "modified"; path: string }
    | { status: "renamed" | "copied"; oldPath: string; newPath: string }
  );

export type InterdiffRow = {
  from: LogEntry | null;
  to: LogEntry | null;
  files: FileDiff[];
};

export type InterdiffResponse = { rows: InterdiffRow[] };
```

```ts
//| id: frontend-api
//| file: src/frontend/api.ts
import * as z from "zod";
import type { InterdiffResponse } from "./model/diff";
import { GitOid, type LogEntry, type OpLogEntry } from "./model/history";
import type {
  PullBaseline,
  PullCommitsResponse,
  PullDiffResponse,
  PullDiffScope,
  PullHistory,
  PullSummary,
} from "./model/pull";
import type { SourceFile } from "./model/source";

const commitRef = z.object({
  kind: z.enum(["bookmark", "tag", "working-copy"]),
  name: z.string(),
});

const commitMarker = z.enum([
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
]);

const logEntry = z.object({
  commitId: z.string(),
  changeId: z.string().nullable(),
  description: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  timestamp: z.string(),
  refs: z.array(commitRef),
  markers: z.array(commitMarker),
});

const opLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  time: z.string(),
  args: z.string(),
});

const changedRange = z.object({ start: z.number(), end: z.number() });

const structuralDiff = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structural"),
    language: z.string(),
    hunks: z.array(
      z.object({
        header: z.string(),
        newStart: z.number(),
        oldStart: z.number(),
        lines: z.array(
          z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("context"),
              code: z.string(),
              newLine: z.number(),
              oldLine: z.number().optional(),
            }),
            z.object({
              kind: z.literal("removed"),
              code: z.string(),
              oldLine: z.number(),
              changes: z.array(changedRange),
            }),
            z.object({
              kind: z.literal("added"),
              code: z.string(),
              newLine: z.number(),
              changes: z.array(changedRange),
            }),
          ]),
        ),
      }),
    ),
  }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);

const fileDiffFields = {
  binary: z.boolean(),
  oldBlob: z.string().nullable(),
  newBlob: z.string().nullable(),
  patch: z.string(),
  structural: structuralDiff,
};

const fileDiff = z.discriminatedUnion("status", [
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

const interdiffResponse = z.object({
  rows: z.array(
    z.object({
      from: logEntry.nullable(),
      to: logEntry.nullable(),
      files: z.array(fileDiff),
    }),
  ),
});

const errorResponse = z.object({ error: z.string() });

/** GET a jj-backed endpoint, turning a 400 into its `error` message. */
async function getJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  const body: unknown = await res.json();

  if (!res.ok) {
    const parsed = errorResponse.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
    );
  }

  return body;
}

export async function fetchOperations(): Promise<OpLogEntry[]> {
  return z
    .array(opLogEntry)
    .parse(await getJson("/api/operations", "GET /api/operations"));
}

export async function fetchLog(atOperation?: string): Promise<LogEntry[]> {
  const query = atOperation ? `?op=${encodeURIComponent(atOperation)}` : "";
  return z
    .array(logEntry)
    .parse(await getJson(`/api/log${query}`, "GET /api/log"));
}

export async function fetchInterdiff(
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return interdiffResponse.parse(
    await getJson(`/api/interdiff?${params}`, "GET /api/interdiff"),
  );
}
```

## Where a side's commits come from

A side of the comparison is a list of commits, and there is more than one place
those commits can come from. A jj operation gives the local repo as it stood
after that step. A head of a pull request gives a branch on GitHub as it stood
before somebody force-pushed over it. `Source` is that choice, a tagged union
rather than an operation with a pull request hanging off it, so a side is
always exactly one of the two and no view has to ask which.

A pull request head is named by its object id and never by the version number
the picker shows. A version is a position in a chain that shifts, so `v7` can
come to mean a different commit while the page is open; the backend's
`pullStateAt` has the full account. Holding the oid makes "show me version 7 of
a pull request that now has three versions" a request nobody can express.

```ts
//| id: frontend-model-history

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

export type GitCommit = {
  commitId: GitOid;
  parents: GitOid[];
  description: string;
  author: string;
  authoredAt: string;
  /** What lines this commit up against another across a force push. The
   *  backend derives it from the subject line, since git records nothing
   *  durable of its own. */
  changeId: string | null;
};
```

```ts
//| id: frontend-model-pull
//| file: src/frontend/model/pull.ts
import type { FileDiff } from "./diff";
import type { GitCommit, GitOid } from "./history";

export type PullCommitsResponse = {
  head: GitOid;
  version: number;
  base: GitOid;
  commits: GitCommit[];
};
```

```ts
//| id: frontend-api

const gitCommit = z.object({
  commitId: GitOid,
  parents: z.array(GitOid),
  description: z.string(),
  author: z.string(),
  authoredAt: z.string(),
  changeId: z.string().nullable(),
});

const pullCommitsResponse = z.object({
  head: GitOid,
  version: z.number(),
  base: GitOid,
  commits: z.array(gitCommit),
});

export async function fetchPullCommits(
  repo: string,
  number: number,
  head: GitOid,
): Promise<PullCommitsResponse> {
  const params = new URLSearchParams({ repo, number: String(number), head });
  return pullCommitsResponse.parse(
    await getJson(
      `/api/github/pull/commits?${params}`,
      "GET /api/github/pull/commits",
    ),
  );
}
```

## Reading a pull request

The pull request screen calls its endpoints in the order the reader moves
through them: the repository's pull requests, then one pull request's chain of
heads, then the diff at or between those heads.

`fetchPullDiff` needs both ends, and the two ends are not the same kind of
thing. `to` is always a head. `from` is a `PullBaseline`, either another head
of the pull request or the branch it targets, and which one it is decides the
comparison the route runs. The [route's own doc](../backend/server.md) has
both comparisons and why each end takes what it takes.

A baseline travels as one parameter, the literal `base` or a 40-hex oid.
Nothing that is 40 hex characters reads as `base`, so the two cannot collide
and the route parses the choice out of the value itself.

```ts
//| id: frontend-model-pull

export type PullState = "OPEN" | "CLOSED" | "MERGED";

export type PullSummary = {
  number: number;
  title: string;
  state: PullState;
  author: string;
  updatedAt: string;
  headRefOid: GitOid;
  baseRefName: string;
  url: string;
};

/** How a head became the head. Only a force push has a time to show. */
export type PullHeadOrigin =
  | { kind: "opened" }
  | { kind: "force-pushed"; at: string }
  | { kind: "current" };

export type PullVersion = {
  /** Position in the chain. A label to show, never a way to ask for a state. */
  version: number;
  head: GitOid;
  origin: PullHeadOrigin;
};

export type PullHistory = {
  number: number;
  baseRefName: string;
  baseRefOid: GitOid;
  /** Oldest first. The last one is the head the branch has now. */
  states: PullVersion[];
  truncated: boolean;
};

/** What the after side is measured against. */
export type PullBaseline = { kind: "base" } | { kind: "version"; head: GitOid };

/** What to diff inside the heads `from`/`to` resolve: both whole heads, one
 *  commit, or the pair across two versions. */
export type PullDiffScope =
  | { kind: "heads" }
  | { kind: "commit"; commit: GitOid }
  | { kind: "pair"; from: GitOid; to: GitOid };

export type PullDiffResponse = {
  from: PullBaseline;
  to: GitOid;
  files: FileDiff[];
};
```

```ts
//| id: frontend-api

const pullSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  author: z.string(),
  updatedAt: z.string(),
  headRefOid: GitOid,
  baseRefName: z.string(),
  url: z.string(),
});

const pullVersion = z.object({
  version: z.number(),
  head: GitOid,
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("opened") }),
    z.object({ kind: z.literal("force-pushed"), at: z.string() }),
    z.object({ kind: z.literal("current") }),
  ]),
});

const pullHistory = z.object({
  number: z.number(),
  baseRefName: z.string(),
  baseRefOid: GitOid,
  states: z.array(pullVersion),
  truncated: z.boolean(),
});

const pullBaseline = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base") }),
  z.object({ kind: z.literal("version"), head: GitOid }),
]);

const pullDiffResponse = z.object({
  from: pullBaseline,
  to: GitOid,
  files: z.array(fileDiff),
});

/** The repository the server was started in, as `owner/name`. */
export async function fetchRepo(): Promise<string> {
  const body = z
    .object({ repo: z.string() })
    .parse(await getJson("/api/github/repo", "GET /api/github/repo"));
  return body.repo;
}

export async function fetchPulls(
  repo: string,
  state: "open" | "closed" | "merged" | "all",
): Promise<PullSummary[]> {
  const params = new URLSearchParams({ repo, state });
  return z
    .array(pullSummary)
    .parse(
      await getJson(`/api/github/pulls?${params}`, "GET /api/github/pulls"),
    );
}

export async function fetchPullHistory(
  repo: string,
  number: number,
): Promise<PullHistory> {
  const params = new URLSearchParams({ repo, number: String(number) });
  return pullHistory.parse(
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
  from: PullBaseline,
  scope: PullDiffScope,
): Promise<PullDiffResponse> {
  const params = new URLSearchParams({
    repo,
    number: String(number),
    to,
    from: from.kind === "base" ? "base" : from.head,
  });
  if (scope.kind === "pair") {
    params.set("fromCommit", scope.from);
    params.set("toCommit", scope.to);
  } else if (scope.kind === "commit") {
    params.set("toCommit", scope.commit);
  }
  return pullDiffResponse.parse(
    await getJson(
      `/api/github/pull/diff?${params}`,
      "GET /api/github/pull/diff",
    ),
  );
}
```

## Reading a file's source

A file diff names the blob behind each side, and `/api/source` answers one of
them whole, [a line at a time and highlighted](../backend/syntax.md). The
path goes with the blob because the path is what says which language to
highlight it as.

```ts
//| id: frontend-api

const syntaxToken = z.object({
  text: z.string(),
  kind: z
    .enum([
      "keyword",
      "string",
      "string-expression",
      "comment",
      "constant",
      "function",
      "parameter",
      "punctuation",
      "link",
    ])
    .nullable(),
});

const sourceFile = z.object({
  language: z.string().nullable(),
  lines: z.array(z.array(syntaxToken)),
});

export async function fetchSource(
  blob: string,
  path: string,
): Promise<SourceFile> {
  const params = new URLSearchParams({ blob, path });
  return sourceFile.parse(
    await getJson(`/api/source?${params}`, "GET /api/source"),
  );
}
```
