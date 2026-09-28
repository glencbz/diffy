// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-state-commits>>[init]
import { useEffect, useState } from "react";
import { fetchLocalCommits, fetchLog, fetchPullCommits } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { GitCommit, LogEntry, Source } from "../model/history";

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
export async function commitsFrom(source: Source): Promise<LogEntry[]> {
  if (source.kind === "jj") {
    return fetchLog(source.operation ?? undefined);
  }

  if (source.kind === "local") {
    const commits = await fetchLocalCommits(source.commits);
    return commits
      .map((commit) => asLogEntry(commit, commit.changeId))
      .reverse();
  }

  // A pull request commit's identity is a subject line, and `changeId` on a
  // LogEntry is what the graph prints as the commit's id, so it stays empty.
  // The pairing reads the identity off the GitCommit instead.
  const { commits } = await fetchPullCommits(
    source.repo,
    source.number,
    source.head,
  );
  return commits.map((commit) => asLogEntry(commit, null));
}

export function useCommits(source: Source): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });
  // A source is a fresh object every render; depend on its JSON and read the
  // source back out of it, so the dependency list cannot drift from the body.
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
// ~/~ end
