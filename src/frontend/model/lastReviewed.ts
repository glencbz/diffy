// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed>>[init]
import * as z from "zod";
import { GitOid, type PullVersion } from "../api";
import type { PullPlace } from "./place";

export const LastReviewed = z.object({ head: GitOid });
export type LastReviewed = z.infer<typeof LastReviewed>;
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed>>[1]
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
