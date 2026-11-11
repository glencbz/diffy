// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[init]

import * as z from "zod";
import type { FileDiff, InterdiffResponse } from "../model/diff";
import type { GitCommit, LogEntry, OpLogEntry } from "../model/history";
import {
  type FoundRepo,
  RecentEntry,
  type RepoSummary,
  type ServedRepo,
} from "../model/repo";
import { READS, type Read } from "../model/routes";
import type { SourceFile } from "../model/source";
import type { CompareAsk } from "./model/compared";
import { inWorkspace, type RepoProbe } from "./model/repo";

const errorResponse = z.object({ error: z.string() });

/** GET `url`, turning a refusal into its `error` message. */
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

/** Ask the server for `route`, of `workspace` when the route reads a
 *  repository, and parse what it answers. */
async function read<Answer extends z.ZodType>(
  route: Read<Answer>,
  workspace: string | null,
  params: ConstructorParameters<typeof URLSearchParams>[0] = {},
): Promise<z.output<Answer>> {
  const query = new URLSearchParams(params);
  if (workspace !== null) query.set("workspace", workspace);
  const url = query.size > 0 ? `${route.path}?${query}` : route.path;
  return route.answer.parse(await getJson(url, `GET ${route.path}`));
}

export function fetchOperations(workspace: string): Promise<OpLogEntry[]> {
  return read(READS.operations, workspace);
}

/** The log at `atOperation`, or, given a `revset`, only what it names
 *  there. */
export function fetchLog(
  workspace: string,
  atOperation?: string,
  revset?: string,
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (atOperation) params.set("op", atOperation);
  if (revset !== undefined) params.set("revset", revset);
  return read(READS.log, workspace, params);
}

export function fetchInterdiff(
  workspace: string,
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return read(READS.interdiff, workspace, params);
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[1]

export function fetchSource(
  workspace: string,
  blob: string,
  path: string,
): Promise<SourceFile> {
  return read(READS.source, workspace, { blob, path });
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[2]

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
  const { file } = await read(READS.compare, workspace, params);
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
  return (await read(READS.comparePaths, workspace, params)).paths;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[3]

/** The commits `ids` name, in that order. */
export function fetchLocalCommits(
  workspace: string,
  ids: string[],
): Promise<GitCommit[]> {
  return read(
    READS.localCommits,
    workspace,
    ids.map((id) => ["id", id]),
  );
}

/** One row of a local review: two commits' interdiff, or one's own diff. */
export async function fetchLocalDiff(
  workspace: string,
  fromCommit: string | null,
  toCommit: string | null,
): Promise<FileDiff[]> {
  const params = new URLSearchParams();
  if (fromCommit !== null) params.set("fromCommit", fromCommit);
  if (toCommit !== null) params.set("toCommit", toCommit);
  return (await read(READS.localDiff, workspace, params)).files;
}

/** Everything the commits `ids` change together. */
export async function fetchLocalSize(
  workspace: string,
  ids: string[],
): Promise<FileDiff[]> {
  const files = await read(
    READS.localSize,
    workspace,
    ids.map((id) => ["id", id]),
  );
  return files.files;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[4]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[5]

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
  return read(READS.repo, null);
}

export async function fetchRecentRepos(): Promise<RepoSummary[]> {
  return read(READS.recentRepos, null);
}

export async function fetchFoundRepos(): Promise<FoundRepo[]> {
  return read(READS.foundRepos, null);
}

export async function probeRepoPath(path: string): Promise<RepoProbe> {
  return read(READS.repoProbe, null, { path });
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
// ~/~ end
