// ~/~ begin <<docs/architecture/frontend/series.md#frontend-model-series>>[init]
import type { LocalReview } from "./review";

/** One version of a series, named the way a reader tells versions apart. */
export interface SeriesVersion {
  /** What the address and the review document name the version by. */
  id: string;
  /** Its place in the series, from 1, which the reader sees as `v3`. */
  number: number;
  /** What the picker says about it after its number. */
  label: string;
}

export interface SeriesHistory {
  /** Oldest first. The last one is the newest. */
  versions: SeriesVersion[];
  /** What a version is compared against when it is read whole: `main`. */
  base: string;
  /** The same, as the picker lists it: `main @ 4915da6`. */
  baseLabel: string;
}

/** What the after side is measured against. */
export type SeriesBaseline = { kind: "base" } | { kind: "version"; id: string };

/** Where a series' versions, commits, and comparisons are read from. */
export type SeriesSource = { kind: "local"; review: LocalReview };

/** A local review's registrations as a series' versions, each named by its
 *  number, since a registration has no id shorter than its operation's. */
export function localHistory(review: LocalReview): SeriesHistory {
  return {
    versions: review.versions.map((version, index) => ({
      id: String(index + 1),
      number: index + 1,
      label: `${version.revset}, ${version.registeredAt.slice(0, 10)}`,
    })),
    base: "its parents",
    baseLabel: "the parents of the oldest commit",
  };
}

/** Where the version a comparison ends on stands on being marked reviewed.
 *  A version already marked shows so whether or not a mark could be
 *  written; one not yet marked offers the mark only with a review document
 *  to record it in. */
export type VersionMark =
  | { kind: "marked" }
  | { kind: "unmarked"; onMark: () => void }
  | { kind: "unavailable" };

/** What the mark's button says before and after, ahead of the version's
 *  name: `Mark reviewed at` and `Reviewed at`. */
export interface MarkLabel {
  mark: string;
  marked: string;
}

/** `v3`, or the id cut short when the history does not list it. */
export function versionName(versions: SeriesVersion[], id: string): string {
  const version = versions.find((candidate) => candidate.id === id);
  return version === undefined ? id.slice(0, 7) : `v${version.number}`;
}

/** What loading one version's commits, or its whole diff, asks for. */
export type VersionAsk = { kind: "local"; commits: string[] };

export function versionAsk(source: SeriesSource, id: string): VersionAsk {
  const version = source.review.versions[Number(id) - 1];
  if (version === undefined) {
    throw new Error(`${source.review.name} has no version ${id}`);
  }
  return { kind: "local", commits: version.commits };
}
// ~/~ end
