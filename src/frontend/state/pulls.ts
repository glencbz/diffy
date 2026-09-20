// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-pulls>>[init]
import { useEffect, useState } from "react";
import { fetchPulls, type PullSummary } from "../api";
import type { AsyncState } from "./asyncState";

export function usePulls(repo: string): AsyncState<PullSummary[]> {
  const [state, setState] = useState<AsyncState<PullSummary[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPulls(repo, "all")
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo]);

  return state;
}
// ~/~ end
