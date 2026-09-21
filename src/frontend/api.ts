// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[init]
import * as z from "zod";

/** A full 40-hex git object id. Branded: only a parsed response mints one. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

/** A name a backend prints beside a commit: see `CommitRef` in the jj module. */
export const CommitRef = z.object({
  kind: z.enum(["bookmark", "tag", "working-copy"]),
  name: z.string(),
});
export type CommitRef = z.infer<typeof CommitRef>;

export const CommitMarker = z.enum([
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
]);
export type CommitMarker = z.infer<typeof CommitMarker>;

export const LogEntry = z.object({
  commitId: z.string(),
  changeId: z.string().nullable(),
  description: z.string(),
  parents: z.array(z.string()),
  /** Whoever the backend names as the author, as it names them. */
  author: z.string(),
  /** ISO 8601. The instant the backend dates this commit by. */
  timestamp: z.string(),
  refs: z.array(CommitRef),
  markers: z.array(CommitMarker),
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[1]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[2]

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
// ~/~ end
