// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[init]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[1]

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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-api>>[3]

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
// ~/~ end
