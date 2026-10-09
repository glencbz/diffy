// ~/~ begin <<docs/architecture/frontend/components.md#frontend-state-components>>[init]
import { useState } from "react";
import type { AsyncState } from "../model/asyncState";
import {
  type ComponentMap,
  componentsTo,
  type RowCounterpart,
} from "../model/components";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import type { Slot } from "../model/pairing";
import {
  rowAsk,
  type SeriesSource,
  type SeriesVersion,
  versionAsk,
  versionName,
} from "../model/series";
import { usePairing } from "./pairing";
import { slotKey, useRowDiffs } from "./rowDiffs";
import { useSeriesCommits } from "./series";

const NO_COMMITS: GitCommit[] = [];
const LOADING: AsyncState<FileDiff[]> = { status: "loading" };

/** The version a version's own diffs are held against, so a reader can see
 *  which places changed: the one before it, or the one after for the first
 *  version. Its commits are paired with this version's and compared, the
 *  same way the series screen pairs two versions. */
export function useCounterpart({
  source,
  series,
  versions,
  to,
  commits,
  maps,
  enabled,
}: {
  source: SeriesSource;
  series: string;
  versions: SeriesVersion[];
  to: string;
  /** The commits of `to`. */
  commits: GitCommit[];
  maps: ComponentMap[];
  enabled: boolean;
}): (commitId: string) => RowCounterpart | null {
  const index = versions.findIndex((version) => version.id === to);
  const before = versions[index - 1];
  const after = versions[index + 1];
  const other = !enabled
    ? null
    : before !== undefined
      ? { id: before.id, since: true }
      : after !== undefined
        ? { id: after.id, since: false }
        : null;

  const loaded = useSeriesCommits(
    other === null ? null : versionAsk(source, other.id),
  );
  const theirs = loaded.status === "ready" ? loaded.data : NO_COMMITS;
  const since = other?.since ?? true;
  const pairing = usePairing(
    since ? theirs : commits,
    since ? commits : theirs,
    null,
  );
  const diffs = useRowDiffs(
    other === null
      ? rowAsk(source, { kind: "base" }, to)
      : rowAsk(
          source,
          { kind: "version", id: since ? other.id : to },
          since ? to : other.id,
        ),
    other === null ? [] : pairing.slots,
  );
  const map = other === null ? undefined : componentsTo(maps, series, other.id);

  return (commitId) => {
    if (other === null) return null;
    const slot = pairing.slots.find(
      (each) =>
        each.left !== null &&
        each.right !== null &&
        (since ? each.right : each.left) === commitId,
    );
    const theirId = since ? slot?.left : slot?.right;
    if (slot === undefined || theirId == null) return null;
    return {
      direction: since ? "since" : "until",
      version: { id: other.id, name: versionName(versions, other.id) },
      commitId: theirId,
      components:
        map?.components.filter((each) => each.commitId === theirId) ?? [],
      files: diffs.get(slotKey(slot)) ?? LOADING,
    };
  };
}

/** Each asked-for commit's own diff, from either version on screen. A peek
 *  asks for one when the reader points at it, so nothing loads unasked. */
export function useOwnDiffs({
  source,
  from,
  to,
  fromCommits,
  toCommits,
}: {
  source: SeriesSource;
  from: string | null;
  to: string;
  fromCommits: GitCommit[];
  toCommits: GitCommit[];
}): [ReadonlyMap<string, AsyncState<FileDiff[]>>, (commitId: string) => void] {
  const [wanted, setWanted] = useState<ReadonlySet<string>>(new Set());
  const slotsIn = (commits: GitCommit[]): Slot[] =>
    commits
      .filter((commit) => wanted.has(commit.commitId))
      .map((commit) => ({ left: null, right: commit.commitId }));
  const fromDiffs = useRowDiffs(
    rowAsk(source, { kind: "base" }, from ?? to),
    from === null ? [] : slotsIn(fromCommits),
  );
  const toDiffs = useRowDiffs(
    rowAsk(source, { kind: "base" }, to),
    slotsIn(toCommits),
  );
  const out = new Map<string, AsyncState<FileDiff[]>>();
  for (const id of wanted) {
    const key = slotKey({ left: null, right: id });
    const found = toDiffs.get(key) ?? fromDiffs.get(key);
    if (found !== undefined) out.set(id, found);
  }
  return [
    out,
    (commitId) =>
      setWanted((now) =>
        now.has(commitId) ? now : new Set(now).add(commitId),
      ),
  ];
}
// ~/~ end
