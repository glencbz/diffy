// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-state-registration>>[init]
import { useCallback, useEffect, useState } from "react";
import { fetchLog, registerLocalReview } from "../api";
import type { AsyncState } from "../model/asyncState";
import { useWorkspace } from "./repo";

const SETTLE_MS = 300;

/** The commit ids `revset` names at `operation`, or null with no revset. */
export function useRevsetMatch(
  operation: string,
  revset: string | null,
): AsyncState<string[]> | null {
  const workspace = useWorkspace();
  const [match, setMatch] = useState<AsyncState<string[]> | null>(null);

  useEffect(() => {
    if (revset === null || revset.trim() === "") {
      setMatch(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setMatch({ status: "loading" });
      fetchLog(workspace, operation, revset).then(
        (log) =>
          live &&
          setMatch({
            status: "ready",
            data: log.map((commit) => commit.commitId),
          }),
        (err: unknown) =>
          live &&
          setMatch({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspace, operation, revset]);

  return match;
}

/** The commit id `trunk()` names at `operation`, or null until it is known
 *  or if jj will not say. Either way the strip can still name the ticks. */
export function useTrunk(operation: string): string | null {
  const workspace = useWorkspace();
  const [trunk, setTrunk] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setTrunk(null);
    fetchLog(workspace, operation, "trunk()").then(
      ([commit]) => live && setTrunk(commit?.commitId ?? null),
      () => live && setTrunk(null),
    );
    return () => {
      live = false;
    };
  }, [workspace, operation]);

  return trunk;
}

/** Registers a version of a local review in this tab's repository. */
export function useRegister(): (
  asked: Parameters<typeof registerLocalReview>[1],
) => Promise<string> {
  const workspace = useWorkspace();
  return useCallback(
    (asked) => registerLocalReview(workspace, asked),
    [workspace],
  );
}
// ~/~ end
