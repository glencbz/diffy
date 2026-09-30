// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-pulls>>[init]
import { useEffect, useState } from "react";
import { fetchPulls, fetchRepo, type PullSummary } from "../api";
import type { AsyncState } from "../model/asyncState";

export interface RepoPulls {
  /** `owner/name`, as the server read it off `origin`. */
  repo: string;
  pulls: PullSummary[];
}

export function usePulls(): AsyncState<RepoPulls> {
  const [state, setState] = useState<AsyncState<RepoPulls>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    fetchRepo()
      .then(async (repo) => ({ repo, pulls: await fetchPulls(repo, "all") }))
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
// ~/~ end
