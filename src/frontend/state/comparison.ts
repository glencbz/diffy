// ~/~ begin <<docs/architecture/frontend.md#frontend-state-comparison>>[init]
import { useEffect, useState } from "react";
import {
  type FileDiff,
  fetchInterdiff,
  fetchPullDiff,
  type GitOid,
  type InterdiffRow,
} from "../api";
import type { AsyncState } from "./asyncState";

/** What the diff panel is being asked for. */
export type Comparison =
  | { kind: "jj"; from: string[]; to: string[] }
  | {
      kind: "pull";
      repo: string;
      number: number;
      /** The earlier head. */
      from: GitOid;
      to: GitOid;
    };

/** The answer, shaped by what was asked. */
export type ComparisonFiles =
  | { kind: "jj"; rows: InterdiffRow[] }
  | { kind: "pull"; files: FileDiff[] };

async function compare(question: Comparison): Promise<ComparisonFiles> {
  if (question.kind === "jj") {
    const { rows } = await fetchInterdiff(question.from, question.to);
    return { kind: "jj", rows };
  }

  const { files } = await fetchPullDiff(
    question.repo,
    question.number,
    question.to,
    question.from,
  );
  return { kind: "pull", files };
}

function hasNothingToAsk(question: Comparison): boolean {
  return (
    question.kind === "jj" &&
    question.from.length === 0 &&
    question.to.length === 0
  );
}

export function useComparison(
  question: Comparison,
): AsyncState<ComparisonFiles> | null {
  const [state, setState] = useState<AsyncState<ComparisonFiles> | null>(null);
  const key = hasNothingToAsk(question) ? "" : JSON.stringify(question);

  useEffect(() => {
    if (key === "") {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    compare(JSON.parse(key) as Comparison)
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
