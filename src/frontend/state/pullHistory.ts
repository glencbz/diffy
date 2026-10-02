// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-pull-history>>[init]
import { useEffect, useState } from "react";
import { fetchPullHistory } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { PullHistory } from "../model/pull";

export function usePullHistory(
  repo: string,
  number: number,
): AsyncState<PullHistory> {
  const [state, setState] = useState<AsyncState<PullHistory>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPullHistory(repo, number)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo, number]);

  return state;
}
// ~/~ end
