# Transport

`api.ts` is the only module that knows a server exists. Its Zod schemas are
private; what they parse into is a plain type in `model/`, and each wrapper
declares that type as its return, so the compiler checks the schema against
the model. `z.infer` would instead make every parser change a silent change
to the app's model.

`LogEntry.changeId` is required but nullable: a git commit says `null`, and a
jj backend that stopped emitting `change_id` fails at the boundary rather than
quietly losing every row's identity. `author` and `timestamp` are display
strings each backend picks to match its own tool.

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

`Source` is where a side's commits come from: a jj operation, or one head of
a pull request, named by oid because versions shift (see
[`pullStateAt`](../backend/github.md#naming-one-state-of-a-pull-request)).

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

`fetchPullDiff` takes a head `to` and a `PullBaseline` `from`, another head or
`base`; [the route](../backend/server.md) explains the two comparisons. The
baseline travels as one parameter, which cannot collide since no oid reads
as `base`.

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
