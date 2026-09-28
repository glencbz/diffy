// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed>>[init]
import * as z from "zod";
import { GitOid, type PullVersion } from "../api";
import type { PullPlace } from "./place";
import type { ReviewedVersion } from "./review";

/** What the browser kept per pull request before the server kept review
 *  state, read once to import it. */
export const LastReviewed = z.object({ head: GitOid });
export type LastReviewed = z.infer<typeof LastReviewed>;

/** The head the reader last reviewed, out of every head they marked on one
 *  pull request: the newest the history still lists, or, when it lists
 *  none of them, the one marked most recently. */
export function lastReviewed(
  marked: ReviewedVersion[],
  states: PullVersion[],
): GitOid | null {
  const heads = new Set(marked.map((mark) => mark.version));
  const listed = [...states].reverse().find((state) => heads.has(state.head));
  if (listed !== undefined) return listed.head;

  const latest = marked.reduce<ReviewedVersion | null>(
    (found, mark) =>
      found === null || mark.reviewedAt > found.reviewedAt ? mark : found,
    null,
  );
  const head = GitOid.safeParse(latest?.version);
  return head.success ? head.data : null;
}
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
