// ~/~ begin <<docs/architecture/frontend.md#frontend-state-interdiff>>[init]
import { useEffect, useState } from "react";
import { fetchInterdiff, type InterdiffResponse } from "../api";
import type { AsyncState } from "./asyncState";

export function useInterdiff(
  from: string[],
  to: string[],
): AsyncState<InterdiffResponse> | null {
  const [state, setState] = useState<AsyncState<InterdiffResponse> | null>(
    null,
  );
  const fromKey = from.join(" ");
  const toKey = to.join(" ");

  useEffect(() => {
    const fromIds = fromKey.split(" ").filter(Boolean);
    const toIds = toKey.split(" ").filter(Boolean);
    if (fromIds.length === 0 && toIds.length === 0) {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    fetchInterdiff(fromIds, toIds)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [fromKey, toKey]);

  return state;
}
// ~/~ end
