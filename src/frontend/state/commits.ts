// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-state-commits>>[init]
import { useEffect, useState } from "react";
import { fetchLocalCommits, fetchLog, fetchPullCommits } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { GitCommit, LogEntry, Source } from "../model/history";
import { useWorkspace } from "./repo";

function asLogEntry(commit: GitCommit, changeId: string | null): LogEntry {
  return {
    commitId: commit.commitId,
    changeId,
    description: commit.description,
    parents: commit.parents,
    author: commit.author,
    timestamp: commit.authoredAt,
    refs: [],
    markers: [],
  };
}

/** The commits a source names. The one place a `Source` decides anything. */
export async function commitsFrom(
  workspace: string,
  source: Source,
): Promise<LogEntry[]> {
  if (source.kind === "jj") {
    return fetchLog(workspace, source.operation ?? undefined);
  }

  if (source.kind === "local") {
    const commits = await fetchLocalCommits(workspace, source.commits);
    return commits
      .map((commit) => asLogEntry(commit, commit.changeId))
      .reverse();
  }

  // A pull request commit's identity is a subject line, and `changeId` on a
  // LogEntry is what the graph prints as the commit's id, so it stays empty.
  // The pairing reads the identity off the GitCommit instead.
  const { commits } = await fetchPullCommits(
    workspace,
    source.repo,
    source.number,
    source.head,
  );
  return commits.map((commit) => asLogEntry(commit, null));
}

/** Logs already read, by workspace and source JSON, oldest read first. */
const kept = new Map<string, LogEntry[]>();
const KEPT_LOGS = 32;

/** A source pinned to an operation, a head, or a commit list names a log
 *  that cannot change; only the live jj log can. */
function keepable(source: Source): boolean {
  return source.kind !== "jj" || source.operation !== null;
}

function keep(key: string, data: LogEntry[]) {
  kept.delete(key);
  kept.set(key, data);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT_LOGS) break;
    kept.delete(oldest);
  }
}

function keptState(key: string): AsyncState<LogEntry[]> {
  const data = kept.get(key);
  return data === undefined ? { status: "loading" } : { status: "ready", data };
}

export function useCommits(source: Source): AsyncState<LogEntry[]> {
  // A source is a fresh object every render; depend on its JSON and read the
  // source back out of it, so the dependency list cannot drift from the body.
  const workspace = useWorkspace();
  const key = JSON.stringify([workspace, source]);
  const [state, setState] = useState(() => keptState(key));

  useEffect(() => {
    const [workspace, source] = JSON.parse(key) as [string, Source];
    const now = keptState(key);
    setState(now);
    if (now.status === "ready") return;
    let live = true;
    commitsFrom(workspace, source)
      .then((data) => {
        if (keepable(source)) keep(key, data);
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
// ~/~ end
