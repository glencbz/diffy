// ~/~ begin <<docs/architecture/frontend.md#frontend-state-interdiff>>[init]
import { useEffect, useState } from "react";
import { fetchInterdiff, type InterdiffResponse } from "../api";
import type { AsyncState } from "./asyncState";

export function useInterdiff(
  from: string | null,
  to: string | null,
): AsyncState<InterdiffResponse> | null {
  const [state, setState] = useState<AsyncState<InterdiffResponse> | null>(
    null,
  );

  useEffect(() => {
    if (from === null && to === null) {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    fetchInterdiff(from, to)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [from, to]);

  return state;
}
// ~/~ end
