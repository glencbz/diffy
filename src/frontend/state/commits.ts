// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-state-commits>>[init]
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
    // A GitCommit carries an identity, but it is a subject line, and
    // `changeId` on a LogEntry is what the graph prints as the commit's id.
    // The pairing reads the identity off the GitCommit instead.
    changeId: null,
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
// ~/~ end
