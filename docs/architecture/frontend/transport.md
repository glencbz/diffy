# Transport

`api.ts` is the only module that knows a server exists. Every shape that
crosses the wire is one Zod schema in [`src/model/`](index.md#model), and its
type is inferred from that schema. The server builds its answers as those
types and `api.ts` parses each response with the same schema, so the two
sides cannot disagree about a field. A plain type on each side with a
private schema in `api.ts` declares every shape three times, and only the
browser's two copies are checked against each other.

A wrapper for a route that reads a repository takes the tab's workspace
first and names it with [`inWorkspace`](repos.md#holding-the-tabs-repository).
Passing it in, rather than the wrapper reading the page's address, keeps
`api.ts` a function of its arguments, the way a test calls it.

`LogEntry.changeId` is required but nullable. A commit of a registered
version is read from git and may have no change id, and the browser draws it
in the same rows as a commit that `jj log` read. The server's own
[`JjLogEntry`](../backend/jj.md#reading-commit-history) narrows it to a
string, since jj always names one.

```ts
//| id: frontend-model-history
//| file: src/model/history.ts
import * as z from "zod";

/** A full 40-hex git object id. Abbreviations are refused. Branded: only a
 *  parse mints one. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

/** A git blob id, whole or abbreviated the way a patch's `index` line prints it. */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{4,64}$/, "expected a hex git blob id")
  .brand("BlobId");
export type BlobId = z.infer<typeof BlobId>;

/** A name `jj log` prints beside a commit. */
export const CommitRef = z.object({
  kind: z.enum(["bookmark", "tag", "working-copy"]),
  /** The name jj shows: `name`, or `name@remote` for a drifted remote ref. */
  name: z.string(),
});
export type CommitRef = z.infer<typeof CommitRef>;

/** The standings `jj log` reports about a commit, in the order jj shows them. */
export const COMMIT_MARKERS = [
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
] as const;
export const CommitMarker = z.enum(COMMIT_MARKERS);
export type CommitMarker = z.infer<typeof CommitMarker>;

export const LogEntry = z.object({
  commitId: z.string(),
  /** Null for a commit that jj did not read, which has no change id. */
  changeId: z.string().nullable(),
  description: z.string(),
  /** Parent commit IDs, in jj's order. Empty only for the root commit. */
  parents: z.array(z.string()),
  /** The author's email, the identity `jj log` prints. */
  author: z.string(),
  /** ISO 8601 committer timestamp, the time `jj log` prints. */
  timestamp: z.string(),
  /** Bookmarks, then tags, then working copies, as `jj log` orders them. */
  refs: z.array(CommitRef),
  markers: z.array(CommitMarker),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** One entry from `jj op log`: a recorded mutation of the repo. */
export const OpLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  /** ISO 8601 time the operation finished. */
  time: z.string(),
  /** The `jj` command line that produced the operation. */
  args: z.string(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;
```

```ts
//| id: frontend-model-diff
//| file: src/model/diff.ts
import * as z from "zod";
import { LogEntry } from "./history";

/** A token difftastic says changed: a range of UTF-16 code units in `code`. */
export const ChangedRange = z.object({ start: z.number(), end: z.number() });
export type ChangedRange = z.infer<typeof ChangedRange>;

/** A line of a structural hunk. Numbers count from 1, as a patch's do. */
export const StructuralLine = z.discriminatedUnion("kind", [
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
    changes: z.array(ChangedRange),
  }),
  z.object({
    kind: z.literal("added"),
    code: z.string(),
    newLine: z.number(),
    changes: z.array(ChangedRange),
  }),
]);
export type StructuralLine = z.infer<typeof StructuralLine>;

export const StructuralHunk = z.object({
  /** A `@@ -a,b +c,d @@` line, so both views label a hunk the same way. */
  header: z.string(),
  /** The after-side number of the hunk's first line, or of the line that
   *  would follow it when the hunk only removes. */
  newStart: z.number(),
  /** The same on the before side. */
  oldStart: z.number(),
  lines: z.array(StructuralLine),
});
export type StructuralHunk = z.infer<typeof StructuralHunk>;

/** A file as [difftastic](../backend/difft.md) reads it: hunks in the same
 *  shape a patch reads into, with each changed line's ranges, or why the
 *  file has none. */
export const StructuralDiff = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structural"),
    language: z.string(),
    hunks: z.array(StructuralHunk),
  }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type StructuralDiff = z.infer<typeof StructuralDiff>;

const served = {
  /** True when jj emitted "Binary files ... differ" in place of a text hunk. */
  binary: z.boolean(),
  /** The git blob each side's contents are stored under, as abbreviated on
   *  the `index` line. Null for a side that does not exist, and for both
   *  sides when the patch has no `index` line at all. */
  oldBlob: z.string().nullable(),
  newBlob: z.string().nullable(),
  /** The verbatim `git`-format unified diff for just this file. */
  patch: z.string(),
  structural: StructuralDiff,
};
const onePath = { path: z.string(), ...served };
const twoPaths = { oldPath: z.string(), newPath: z.string(), ...served };

/** How one file changed between two trees: its patch, and the same change
 *  as difftastic reads it or why it cannot. This is what the server sends. */
export const ServedFileDiff = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), ...onePath }),
  z.object({ status: z.literal("deleted"), ...onePath }),
  z.object({ status: z.literal("modified"), ...onePath }),
  z.object({ status: z.literal("renamed"), ...twoPaths }),
  z.object({ status: z.literal("copied"), ...twoPaths }),
]);
export type ServedFileDiff = z.infer<typeof ServedFileDiff>;

/** A served file before difftastic has read it. */
export type PatchFile = ServedFileDiff extends infer File
  ? File extends unknown
    ? Omit<File, "structural">
    : never
  : never;

type TwoPaths = Extract<ServedFileDiff, { oldPath: string }>;

/** A served file, or a pair of paths the reader chose to compare. The
 *  server never sends `compared`. */
export type FileDiff =
  | ServedFileDiff
  | (Omit<TwoPaths, "status"> & { status: "compared" });

export const InterdiffRow = z.object({
  from: LogEntry.nullable(),
  to: LogEntry.nullable(),
  files: z.array(ServedFileDiff),
});
export type InterdiffRow = {
  from: LogEntry | null;
  to: LogEntry | null;
  files: FileDiff[];
};

export const InterdiffResponse = z.object({ rows: z.array(InterdiffRow) });
export type InterdiffResponse = { rows: InterdiffRow[] };
```

```ts
//| id: frontend-api
//| file: src/frontend/api.ts

import * as z from "zod";
import {
  type FileDiff,
  InterdiffResponse,
  ServedFileDiff,
} from "../model/diff";
import { GitCommit, LogEntry, OpLogEntry } from "../model/history";
import {
  FoundRepo,
  Probe,
  RecentEntry,
  RepoSummary,
  ServedRepo,
} from "../model/repo";
import { SourceFile } from "../model/source";
import type { CompareAsk } from "./model/compared";
import { inWorkspace, type RepoProbe } from "./model/repo";

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

export async function fetchOperations(
  workspace: string,
): Promise<OpLogEntry[]> {
  return z
    .array(OpLogEntry)
    .parse(
      await getJson(
        inWorkspace("/api/operations", workspace),
        "GET /api/operations",
      ),
    );
}

/** The log at `atOperation`, or, given a `revset`, only what it names
 *  there. */
export async function fetchLog(
  workspace: string,
  atOperation?: string,
  revset?: string,
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (atOperation) params.set("op", atOperation);
  if (revset !== undefined) params.set("revset", revset);
  const query = params.size > 0 ? `?${params}` : "";
  return z
    .array(LogEntry)
    .parse(
      await getJson(inWorkspace(`/api/log${query}`, workspace), "GET /api/log"),
    );
}

export async function fetchInterdiff(
  workspace: string,
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return InterdiffResponse.parse(
    await getJson(
      inWorkspace(`/api/interdiff?${params}`, workspace),
      "GET /api/interdiff",
    ),
  );
}
```

## Where a side's commits come from

`Source` is where a side's commits come from: a jj operation, or a version of a
[local review](local-reviews.md), as the commits it registered.

```ts
//| id: frontend-model-history

/** A view of the local repo: the jj operation to read its log at. */
export type JjSource = { kind: "jj"; operation: string | null };

/** One version of a local review, named by the commits it registered. */
export type LocalSource = { kind: "local"; commits: string[] };

/** Where one side's commits come from. */
export type Source = JjSource | LocalSource;

/** One commit of a registered version. */
export const GitCommit = z.object({
  commitId: GitOid,
  parents: z.array(GitOid),
  /** Full commit message, subject and body, as `LogEntry.description`. */
  description: z.string(),
  author: z.string(),
  /** ISO 8601 author date. */
  authoredAt: z.string(),
  /** What lines this commit up against another across a rewrite: its jj
   *  change id, or null when it has none. */
  changeId: z.string().nullable(),
});
export type GitCommit = z.infer<typeof GitCommit>;
```

## Reading a file's source

```ts
//| id: frontend-api

export async function fetchSource(
  workspace: string,
  blob: string,
  path: string,
): Promise<SourceFile> {
  const params = new URLSearchParams({ blob, path });
  return SourceFile.parse(
    await getJson(
      inWorkspace(`/api/source?${params}`, workspace),
      "GET /api/source",
    ),
  );
}
```

## Comparing two files by hand

The server answers a [compared pair](../backend/compare.md) as a rename, and
`fetchCompared` relabels it, because only the reader's choice makes it one.
The schema stays the server's, so a response claiming to be `compared` would
fail to parse.

```ts
//| id: frontend-api

/** `ask.newPath` on the row's after side, read against `ask.oldPath` on its
 *  before side. */
export async function fetchCompared(
  workspace: string,
  ask: CompareAsk,
): Promise<FileDiff> {
  const params = new URLSearchParams({
    toCommit: ask.toCommit,
    oldPath: ask.oldPath,
    newPath: ask.newPath,
  });
  if (ask.fromCommit !== null) params.set("fromCommit", ask.fromCommit);
  const { file } = z
    .object({ file: ServedFileDiff })
    .parse(
      await getJson(
        inWorkspace(`/api/compare?${params}`, workspace),
        "GET /api/compare",
      ),
    );
  if ("path" in file) {
    throw new Error(`GET /api/compare answered a ${file.status} file`);
  }
  return { ...file, status: "compared" };
}

/** Every path on a row's before side. */
export async function fetchBeforePaths(
  workspace: string,
  fromCommit: string | null,
  toCommit: string,
): Promise<string[]> {
  const params = new URLSearchParams({ toCommit });
  if (fromCommit !== null) params.set("fromCommit", fromCommit);
  return z
    .object({ paths: z.array(z.string()) })
    .parse(
      await getJson(
        inWorkspace(`/api/compare/paths?${params}`, workspace),
        "GET /api/compare/paths",
      ),
    ).paths;
}
```

## Reading a local review

A local review's version is a list of commit ids, so its routes take ids and
never a revset. The revset was evaluated once, when the version was
registered, and evaluating it again would read today's repository instead of
the one the author declared ready. Each route does one job: one
version's commits, one row's comparison, or the size of the whole.

```ts
//| id: frontend-api

/** The commits `ids` name, in that order. */
export async function fetchLocalCommits(
  workspace: string,
  ids: string[],
): Promise<GitCommit[]> {
  const params = new URLSearchParams(ids.map((id) => ["id", id]));
  return z
    .array(GitCommit)
    .parse(
      await getJson(
        inWorkspace(`/api/local/commits?${params}`, workspace),
        "GET /api/local/commits",
      ),
    );
}

const filesResponse = z.object({ files: z.array(ServedFileDiff) });

/** One row of a local review: two commits' interdiff, or one's own diff. */
export async function fetchLocalDiff(
  workspace: string,
  fromCommit: string | null,
  toCommit: string | null,
): Promise<FileDiff[]> {
  const params = new URLSearchParams();
  if (fromCommit !== null) params.set("fromCommit", fromCommit);
  if (toCommit !== null) params.set("toCommit", toCommit);
  const body = await getJson(
    inWorkspace(`/api/local/diff?${params}`, workspace),
    "GET /api/local/diff",
  );
  return filesResponse.parse(body).files;
}

/** Everything the commits `ids` change together. */
export async function fetchLocalSize(
  workspace: string,
  ids: string[],
): Promise<FileDiff[]> {
  const params = new URLSearchParams(ids.map((id) => ["id", id]));
  const body = await getJson(
    inWorkspace(`/api/local/size?${params}`, workspace),
    "GET /api/local/size",
  );
  return filesResponse.parse(body).files;
}
```

Registering is the one request that hands the server a revset to keep, and
`fetchLog`'s `revset` is the one that previews it. It goes through its own
route rather than a [review command](review.md#review-state), because the
server has to evaluate the revset before there is a version to record. The
answer is the name the version went under. The document it changed reaches
every open screen the way any other change does, so the caller does not
apply the answer itself.

```ts
//| id: frontend-api

/** Register a version of a local review at `operation`, and answer the name
 *  it went under. The review document announces the change to every open
 *  screen. */
export async function registerLocalReview(
  workspace: string,
  asked: {
    name: string;
    revset: string;
    operation: string;
  },
): Promise<string> {
  const res = await fetch(inWorkspace("/api/local/reviews", workspace), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(asked),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const parsed = errorResponse.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error : `registering failed (${res.status})`,
    );
  }
  return z.object({ name: z.string() }).parse(body).name;
}
```

## The repository picker

The [repository picker](repos.md)'s endpoints. A refusal to open a path
arrives as its `error` message, which the picker shows as it is.

```ts
//| id: frontend-api

/** Send `body` as JSON, turning a refusal into its `error` message. */
async function sendJson(
  method: string,
  url: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer: unknown = await res.json();
  if (!res.ok) {
    const parsed = errorResponse.safeParse(answer);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : `${method} ${url} failed (${res.status})`,
    );
  }
  return answer;
}

export async function fetchServedRepo(): Promise<ServedRepo> {
  return ServedRepo.parse(await getJson("/api/repo", "GET /api/repo"));
}

export async function fetchRecentRepos(): Promise<RepoSummary[]> {
  return z
    .array(RepoSummary)
    .parse(await getJson("/api/repo/recent", "GET /api/repo/recent"));
}

export async function fetchFoundRepos(): Promise<FoundRepo[]> {
  return z
    .array(FoundRepo)
    .parse(await getJson("/api/repo/found", "GET /api/repo/found"));
}

export async function probeRepoPath(path: string): Promise<RepoProbe> {
  const params = new URLSearchParams({ path });
  return Probe.parse(
    await getJson(`/api/repo/probe?${params}`, "GET /api/repo/probe"),
  );
}

/** Serve the repository holding `path`, and answer its root. */
export async function openRepo(path: string): Promise<string> {
  const answer = await sendJson("POST", "/api/repo", { path });
  return z.object({ root: z.string() }).parse(answer).root;
}

export async function forgetRecentRepo(
  root: string,
): Promise<RecentEntry | null> {
  const answer = await sendJson("DELETE", "/api/repo/recent", { root });
  return z.object({ removed: RecentEntry.nullable() }).parse(answer).removed;
}

export async function restoreRecentRepo(entry: RecentEntry): Promise<void> {
  await sendJson("PUT", "/api/repo/recent", entry);
}
```
