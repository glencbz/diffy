// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed>>[init]
import { useCallback, useMemo } from "react";
import type { GitOid, PullVersion } from "../api";
import { lastReviewedRepository } from "../persistence/lastReviewed";
import type { PullPlace } from "./place";
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
// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed>>[1]
/** The place a pull request opens on, given the head this reader last
 *  reviewed and the heads the pull request has had, oldest first. */
export function opening(
  place: PullPlace,
  reviewed: GitOid | null,
  states: PullVersion[],
): PullPlace {
  const bare =
    place.from.kind === "base" && place.to === null && place.spot === null;
  if (!bare || reviewed === null || reviewed === states.at(-1)?.head) {
    return place;
  }
  if (!states.some((state) => state.head === reviewed)) return place;
  return { ...place, from: { kind: "version", head: reviewed } };
}
// ~/~ end
