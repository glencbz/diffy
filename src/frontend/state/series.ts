// ~/~ begin <<docs/architecture/frontend/series.md#frontend-state-series>>[init]
import { useEffect, useState } from "react";
import {
  fetchLocalCommits,
  fetchLocalSize,
  fetchPullCommits,
  fetchPullDiff,
} from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import {
  type SeriesSource,
  type SeriesVersion,
  type VersionAsk,
  versionAsk,
} from "../model/series";
import type { VersionCommits } from "../model/threads";
import { useWorkspace } from "./repo";

/** One version's commits, oldest first, the order the pairing and the stack
 *  read in. The backend lists them newest first, as `git log` does. */
function versionCommits(
  workspace: string,
  ask: VersionAsk,
): Promise<GitCommit[]> {
  if (ask.kind === "local") return fetchLocalCommits(workspace, ask.commits);
  return fetchPullCommits(workspace, ask.repo, ask.number, ask.head).then(
    (answer) => [...answer.commits].reverse(),
  );
}

/** Every file one version changes against its base. */
function versionSize(workspace: string, ask: VersionAsk): Promise<FileDiff[]> {
  if (ask.kind === "local") return fetchLocalSize(workspace, ask.commits);
  return fetchPullDiff(
    workspace,
    ask.repo,
    ask.number,
    ask.head,
    { kind: "base" },
    { kind: "heads" },
  ).then((answer) => answer.files);
}

/** What `load` answers for `ask`, kept loaded while `ask` stays the same.
 *  No ask reads as nothing, which is how a comparison against the base asks
 *  for no before side, and one between versions for no whole size. */
function useLoaded<A, T>(
  ask: A | null,
  load: (workspace: string, ask: A) => Promise<T>,
  none: T,
): AsyncState<T> {
  const workspace = useWorkspace();
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const key = JSON.stringify([workspace, ask]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `workspace` and `ask`, and `load` and `none` are fixed per caller
  useEffect(() => {
    let live = true;
    if (ask === null) {
      setState({ status: "ready", data: none });
      return;
    }
    setState({ status: "loading" });
    load(workspace, ask).then(
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

export function useSeriesSize(ask: VersionAsk | null): AsyncState<FileDiff[]> {
  return useLoaded(ask, versionSize, NONE);
}

export function useEveryVersion(
  source: SeriesSource,
  versions: SeriesVersion[],
): AsyncState<VersionCommits[]> {
  const asks = versions.map((version) => ({
    version,
    ask: versionAsk(source, version.id),
  }));
  return useLoaded(asks, everyVersion, NONE);
}

function everyVersion(
  workspace: string,
  asks: { version: SeriesVersion; ask: VersionAsk }[],
): Promise<VersionCommits[]> {
  return Promise.all(
    asks.map(async ({ version, ask }) => ({
      version,
      commits: await versionCommits(workspace, ask),
    })),
  );
}
// ~/~ end
