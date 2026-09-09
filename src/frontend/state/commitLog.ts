// ~/~ begin <<docs/architecture/frontend.md#frontend-state-commit-log>>[init]
import { useEffect, useState } from "react";
import { fetchLog, type LogEntry } from "../api";
import type { AsyncState } from "./asyncState";

export function useCommitLog(): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    fetchLog()
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
