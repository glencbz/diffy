// ~/~ begin <<docs/architecture/frontend/series.md#frontend-state-series>>[init]
import { useEffect, useState } from "react";
import { fetchPullCommits, fetchPullDiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import type { VersionAsk } from "../model/series";

/** One version's commits, oldest first, the order the pairing and the stack
 *  read in. The backend lists them newest first, as `git log` does. */
function versionCommits(ask: VersionAsk): Promise<GitCommit[]> {
  return fetchPullCommits(ask.repo, ask.number, ask.head).then((answer) =>
    [...answer.commits].reverse(),
  );
}

/** Every file one version changes against its base. */
function versionSize(ask: VersionAsk): Promise<FileDiff[]> {
  return fetchPullDiff(
    ask.repo,
    ask.number,
    ask.head,
    { kind: "base" },
    { kind: "heads" },
  ).then((answer) => answer.files);
}

/** What `load` answers for `ask`, kept loaded while `ask` stays the same.
 *  No ask reads as nothing, which is how a comparison against the base asks
 *  for no before side. */
function useLoaded<T>(
  ask: VersionAsk | null,
  load: (ask: VersionAsk) => Promise<T>,
  none: T,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const key = JSON.stringify(ask);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ask`, and `load` and `none` are fixed per caller
  useEffect(() => {
    let live = true;
    if (ask === null) {
      setState({ status: "ready", data: none });
      return;
    }
    setState({ status: "loading" });
    load(ask).then(
      (data) => {
        if (live) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}

const NONE: never[] = [];

export function useSeriesCommits(
  ask: VersionAsk | null,
): AsyncState<GitCommit[]> {
  return useLoaded(ask, versionCommits, NONE);
}

export function useSeriesSize(ask: VersionAsk): AsyncState<FileDiff[]> {
  return useLoaded(ask, versionSize, NONE);
}
// ~/~ end
