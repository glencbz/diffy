// ~/~ begin <<docs/architecture/frontend.md#frontend-state-revision-diff>>[init]
import { useEffect, useState } from "react";
import { type DiffResponse, fetchDiff } from "../api";
import type { AsyncState } from "./asyncState";

export function useRevisionDiff(
  revision: string | null,
): AsyncState<DiffResponse> | null {
  const [state, setState] = useState<AsyncState<DiffResponse> | null>(null);

  useEffect(() => {
    if (revision === null) {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    fetchDiff(revision)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [revision]);

  return state;
}
// ~/~ end
