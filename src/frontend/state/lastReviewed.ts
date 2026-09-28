// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed>>[init]
import { useCallback, useMemo } from "react";
import type { GitOid } from "../api";
import { lastReviewedRepository } from "../persistence/lastReviewed";
import { useStored } from "./stored";

export function useLastReviewed(
  repo: string,
  number: number,
): [GitOid | null, (head: GitOid) => void] {
  const repository = useMemo(
    () => lastReviewedRepository(repo, number),
    [repo, number],
  );
  const [stored, update] = useStored(repository);
  const mark = useCallback(
    (head: GitOid) => update(() => ({ head })),
    [update],
  );
  return [stored?.head ?? null, mark];
}
// ~/~ end
