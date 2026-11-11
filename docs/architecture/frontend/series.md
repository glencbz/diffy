# Series

A series is work reviewed version by version: a local review registered more
than once. This document holds the shapes the
[series review screen](series-review.md#series-review-controller) reads a
series through, and the hooks that load one version.

## Describing a series

A version's `id` is what the address and the review document store; its
`number` is what the reader sees, `v3`. Ids are plain strings, since everything
only compares and stores them.

The screen reads a `SeriesSource` through `versionAsk`, which turns it into
what a load needs, as [`Source`](transport.md#where-a-sides-commits-come-from)
does for a commit list.

```ts
//| id: frontend-model-series
//| file: src/frontend/model/series.ts
import type { LocalReview } from "../../model/review";

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
```

A local review's versions are its registrations, and `localHistory` names
each by its number. A registration's operation id would be the other
candidate, and it loses because it is a hundred and twenty-eight characters
of hex in every address, where a number reads as the `v2` the picker shows.
Numbers stay put because a registration is only ever added, or replaced in
place when a second one arrives at the same operation. A local review has no
base branch, so its base is whatever the oldest commit was built on.

A version's ask carries the commit ids it registered, and a row asks for
nothing beyond its own two commits, since a local commit is read by id with no
series around it.

```ts
//| id: frontend-model-series-test
//| file: src/frontend/model/series.test.ts
import { describe, expect, test } from "bun:test";
import type { LocalReview } from "../../model/review";
import { localHistory, versionAsk } from "./series";

const review: LocalReview = {
  name: "stack",
  versions: [
    {
      operation: "op1",
      revset: "trunk()..stack",
      commits: ["c1", "c2"],
      registeredAt: "2026-09-27T10:00:00Z",
    },
    {
      operation: "op2",
      revset: "trunk()..stack",
      commits: ["c3"],
      registeredAt: "2026-09-28T10:00:00Z",
    },
  ],
};

describe("localHistory", () => {
  test("numbers registrations from 1 and names them by number", () => {
    expect(localHistory(review).versions).toEqual([
      { id: "1", number: 1, label: "trunk()..stack, 2026-09-27" },
      { id: "2", number: 2, label: "trunk()..stack, 2026-09-28" },
    ]);
  });
});

describe("versionAsk", () => {
  test("asks for the commits a local version registered", () => {
    const source = { kind: "local", review } as const;

    expect(versionAsk(source, "2")).toEqual({ kind: "local", commits: ["c3"] });
    expect(() => versionAsk(source, "3")).toThrow("stack has no version 3");
  });
});
```

## Reading a series

Every hook keys its load by the ask's content rather than its identity,
since an ask is built fresh on every render.

`useEveryVersion` loads every version's commits at once, for the
[threads](threads.md#which-threads-a-series-has) of the whole series. It asks
one version at a time, as the stack does, so a version's commits are read the
way its comparisons read them.

```ts
//| id: frontend-state-series
//| file: src/frontend/state/series.ts
import { useEffect, useState } from "react";
import type { AsyncState } from "../../model/asyncState";
import type { FileDiff } from "../../model/diff";
import type { GitCommit } from "../../model/history";
import { fetchLocalCommits, fetchLocalSize } from "../api";
import {
  type SeriesSource,
  type SeriesVersion,
  type VersionAsk,
  versionAsk,
} from "../model/series";
import type { VersionCommits } from "../model/threads";
import { useWorkspace } from "./repo";

/** One version's commits, oldest first, the order the pairing and the stack
 *  read in. */
function versionCommits(
  workspace: string,
  ask: VersionAsk,
): Promise<GitCommit[]> {
  return fetchLocalCommits(workspace, ask.commits);
}

/** Every file one version changes against its base. */
function versionSize(workspace: string, ask: VersionAsk): Promise<FileDiff[]> {
  return fetchLocalSize(workspace, ask.commits);
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
```
