// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-state-comparison>>[init]
import { useEffect, useState } from "react";
import { fetchInterdiff, type InterdiffRow } from "../api";
import type { AsyncState } from "./asyncState";

/** What the diff panel is being asked for. */
export interface Comparison {
  from: string[];
  to: string[];
}

export function useComparison(
  question: Comparison,
): AsyncState<InterdiffRow[]> | null {
  const [state, setState] = useState<AsyncState<InterdiffRow[]> | null>(null);
  const key =
    question.from.length === 0 && question.to.length === 0
      ? ""
      : JSON.stringify(question);

  useEffect(() => {
    if (key === "") {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    const { from, to } = JSON.parse(key) as Comparison;
    fetchInterdiff(from, to)
      .then(({ rows }) => {
        if (live) setState({ status: "ready", data: rows });
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
