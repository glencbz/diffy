// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[init]
import * as z from "zod";
import type { FileDiff, InterdiffResponse } from "./model/diff";
import {
  type GitCommit,
  GitOid,
  type LogEntry,
  type OpLogEntry,
} from "./model/history";
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[1]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[2]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[3]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[4]

/** The commits `ids` name, in that order. */
export async function fetchLocalCommits(ids: string[]): Promise<GitCommit[]> {
  const params = new URLSearchParams(ids.map((id) => ["id", id]));
  return z
    .array(gitCommit)
    .parse(
      await getJson(`/api/local/commits?${params}`, "GET /api/local/commits"),
    );
}

const filesResponse = z.object({ files: z.array(fileDiff) });

/** One row of a local review: two commits' interdiff, or one's own diff. */
export async function fetchLocalDiff(
  fromCommit: string | null,
  toCommit: string | null,
): Promise<FileDiff[]> {
  const params = new URLSearchParams();
  if (fromCommit !== null) params.set("fromCommit", fromCommit);
  if (toCommit !== null) params.set("toCommit", toCommit);
  const body = await getJson(
    `/api/local/diff?${params}`,
    "GET /api/local/diff",
  );
  return filesResponse.parse(body).files;
}

/** Everything the commits `ids` change together. */
export async function fetchLocalSize(ids: string[]): Promise<FileDiff[]> {
  const params = new URLSearchParams(ids.map((id) => ["id", id]));
  const body = await getJson(
    `/api/local/size?${params}`,
    "GET /api/local/size",
  );
  return filesResponse.parse(body).files;
}
// ~/~ end
