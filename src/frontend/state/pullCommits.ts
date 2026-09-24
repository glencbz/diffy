// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-pull-commits>>[init]
import { useEffect, useState } from "react";
import { fetchPullCommits, type GitCommit, type GitOid } from "../api";
import type { AsyncState } from "./asyncState";

/** One version's commits, oldest first, as the pull request's own, so the
 *  pairing can read the identity the graph deliberately drops. */
export function usePullCommits(
  repo: string,
  number: number,
  head: GitOid | null,
): AsyncState<GitCommit[]> {
  const [state, setState] = useState<AsyncState<GitCommit[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;

    if (head === null) {
      setState({ status: "ready", data: [] });
      return;
    }

    setState({ status: "loading" });
    fetchPullCommits(repo, number, head)
      .then((data) => {
        if (live) {
          setState({ status: "ready", data: [...data.commits].reverse() });
        }
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });

    return () => {
      live = false;
    };
  }, [repo, number, head]);

  return state;
}
// ~/~ end
