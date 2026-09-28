// ~/~ begin <<docs/architecture/frontend/series.md#frontend-model-series>>[init]
import { GitOid } from "./history";
import type { PullBaseline, PullHeadOrigin, PullHistory } from "./pull";

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
  /** Whether versions are known to be missing from the list. */
  truncated: boolean;
}

/** What the after side is measured against. */
export type SeriesBaseline = { kind: "base" } | { kind: "version"; id: string };

/** Where a series' versions, commits, and comparisons are read from. */
export type SeriesSource = { kind: "pull"; repo: string; number: number };

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") {
    return `force-pushed ${origin.at.slice(0, 10)}`;
  }
  return origin.kind;
}

/** A pull request's heads as a series' versions, each named by its head. */
export function pullHistory(history: PullHistory): SeriesHistory {
  return {
    versions: history.states.map((state) => ({
      id: state.head,
      number: state.version,
      label: `${state.head.slice(0, 7)}, ${when(state.origin)}`,
    })),
    base: history.baseRefName,
    baseLabel: `${history.baseRefName} @ ${history.baseRefOid.slice(0, 7)}`,
    truncated: history.truncated,
  };
}

/** `v3`, or the id cut short when the history does not list it. */
export function versionName(versions: SeriesVersion[], id: string): string {
  const version = versions.find((candidate) => candidate.id === id);
  return version === undefined ? id.slice(0, 7) : `v${version.number}`;
}

/** What loading one version's commits, or its whole diff, asks for. */
export type VersionAsk = {
  kind: "pull";
  repo: string;
  number: number;
  head: GitOid;
};

export function versionAsk(source: SeriesSource, id: string): VersionAsk {
  return { ...source, head: GitOid.parse(id) };
}

/** What loading one row's comparison asks for, beside the row's commits. */
export type RowAsk = {
  kind: "pull";
  repo: string;
  number: number;
  from: PullBaseline;
  to: GitOid;
};

export function rowAsk(
  source: SeriesSource,
  from: SeriesBaseline,
  to: string,
): RowAsk {
  return {
    ...source,
    from:
      from.kind === "base"
        ? from
        : { kind: "version", head: GitOid.parse(from.id) },
    to: GitOid.parse(to),
  };
}
// ~/~ end
