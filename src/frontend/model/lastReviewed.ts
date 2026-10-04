// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed>>[init]
import * as z from "zod";
import { GitOid } from "./history";
import type { SeriesPlace } from "./place";
import type { ReviewedVersion } from "./review";
import type { SeriesVersion } from "./series";

/** What the browser kept per pull request before the server kept review
 *  state, read once to import it. */
export const LastReviewed = z.object({ head: GitOid });
export type LastReviewed = z.infer<typeof LastReviewed>;

/** The version the reader last reviewed, out of every version they marked
 *  in one series: the newest the history still lists, or, when it lists
 *  none of them, the one marked most recently. */
export function lastReviewed(
  marked: ReviewedVersion[],
  versions: SeriesVersion[],
): string | null {
  const ids = new Set(marked.map((mark) => mark.version));
  const listed = [...versions].reverse().find((version) => ids.has(version.id));
  if (listed !== undefined) return listed.id;

  const latest = marked.reduce<ReviewedVersion | null>(
    (found, mark) =>
      found === null || mark.reviewedAt > found.reviewedAt ? mark : found,
    null,
  );
  return latest?.version ?? null;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed>>[1]
/** The place a series opens on, given the version this reader last
 *  reviewed and the versions the series has had, oldest first. */
export function opening<P extends SeriesPlace>(
  place: P,
  reviewed: string | null,
  versions: SeriesVersion[],
): P {
  const bare =
    place.from.kind === "base" && place.to === null && place.spot === null;
  if (!bare || reviewed === null || reviewed === versions.at(-1)?.id) {
    return place;
  }
  if (!versions.some((version) => version.id === reviewed)) return place;
  return { ...place, from: { kind: "version", id: reviewed } };
}
// ~/~ end
