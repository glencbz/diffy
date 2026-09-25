// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-pull-files>>[init]
import { useEffect, useState } from "react";
import { type FileDiff, fetchPullDiff, type GitOid } from "../api";
import type { AsyncState } from "./asyncState";

/** Every file one version changes against its base, as the pull request
 *  would land it. */
export function usePullFiles(
  repo: string,
  number: number,
  head: GitOid,
): AsyncState<FileDiff[]> {
  const [state, setState] = useState<AsyncState<FileDiff[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;

    setState({ status: "loading" });
    fetchPullDiff(repo, number, head, { kind: "base" }, { kind: "heads" })
      .then((data) => {
        if (live) setState({ status: "ready", data: data.files });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });

    return () => {
      live = false;
    };
  }, [repo, number, head]);

  return state;
}
// ~/~ end
