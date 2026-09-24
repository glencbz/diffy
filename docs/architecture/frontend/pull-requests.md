# Pull requests

The screen that reviews a history nobody has locally, where a side is pinned
to one of the heads the branch has had.

## Loading the list and one pull's heads

`usePulls` loads the repository's pull requests in every state. A merged pull
request that was force-pushed on the way is exactly the history worth reading
back, and a list of open ones would never reach it.

```tsx
//| id: frontend-state-pulls
//| file: src/frontend/state/pulls.ts
import { useEffect, useState } from "react";
import { fetchPulls, type PullSummary } from "../api";
import type { AsyncState } from "./asyncState";

export function usePulls(repo: string): AsyncState<PullSummary[]> {
  const [state, setState] = useState<AsyncState<PullSummary[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPulls(repo, "all")
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo]);

  return state;
}
```

`usePullHistory` loads one pull request's chain of heads. Everything the review
pane shows below the header depends on it, down to which head counts as the
latest, so it loads first and on its own.

```tsx
//| id: frontend-state-pull-history
//| file: src/frontend/state/pullHistory.ts
import { useEffect, useState } from "react";
import { fetchPullHistory, type PullHistory } from "../api";
import type { AsyncState } from "./asyncState";

export function usePullHistory(
  repo: string,
  number: number,
): AsyncState<PullHistory> {
  const [state, setState] = useState<AsyncState<PullHistory>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPullHistory(repo, number)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo, number]);

  return state;
}
```

The graph draws a commit by its id and never needs a real change id, so
[`useCommits`](commit-history.md) maps every pull request commit through
`asLogEntry`, which sets `changeId` to null on the way there. Reusing that
hook for the pairing would read back exactly the field it strips.
`usePullCommits` loads the same commits straight off `GitCommit`, so the
pairing sees the guess GitHub's subject line encodes instead of the null the
graph's own model has no room for.

`usePullCommits` also turns the backend's newest-first list around, so every
lane, row, and section on this screen reads oldest first. A pull request is
read as a sequence, each commit building on the one before it, and a reader
going top to bottom should meet a commit before the ones that depend on it.
Reversing here rather than in each view means the pairing, the paired graph,
and the commit stack cannot disagree about which end is up.

```tsx
//| id: frontend-state-pull-commits
//| file: src/frontend/state/pullCommits.ts
import { useEffect, useState } from "react";
import { fetchPullCommits, type GitCommit, type GitOid } from "../api";
import type { AsyncState } from "./asyncState";

/** One version's commits, oldest first, as the pull request's own, so the
 *  pairing can read the identity the graph deliberately drops. */
export function usePullCommits(
  repo: string,
  number: number,
  head: GitOid | null,
): AsyncState<GitCommit[]> {
  const [state, setState] = useState<AsyncState<GitCommit[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;

    if (head === null) {
      setState({ status: "ready", data: [] });
      return;
    }

    setState({ status: "loading" });
    fetchPullCommits(repo, number, head)
      .then((data) => {
        if (live) {
          setState({ status: "ready", data: [...data.commits].reverse() });
        }
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });

    return () => {
      live = false;
    };
  }, [repo, number, head]);

  return state;
}
```
## Pull requests controller

The list, and whichever pull request is picked out of it. What the screen is
doing lives here rather than in `App` because the list is the only other thing
that reads it, and the summary it selects is what the header needs.

One `Screen` says which of three things a reader is in the middle of: browsing
the list, reading a review, or picking a different pull request over the one
they are reading. A number beside a flag would say the same until the flag
said a sheet was open with nothing under it, and [the layout](layout.md) has
no such screen to draw. Opening and dismissing are whole functions of the
screen they are handed, so a press that lands in the wrong phase gives that
phase back rather than inventing one.

Only a narrow window puts those three anywhere, since a wide one shows the
list and the review side by side and has nothing to collapse.

A pull request the list no longer holds reads as none at all, which is the
one place `chosen` can answer something the reader did not ask for. The list
is reloaded per repository and a number is kept across that, so the choice can
outlive the row it came from, and dropping back to browsing is the only answer
that leaves a screen a reader can act on.

`PullReview` is keyed by the pull request number, so picking a different one
remounts it and the two ends of the comparison start again at "the first head
against the latest". Clearing them by hand would be the same behaviour written
out, with a way to forget a field.

```tsx
//| id: frontend-controller-pull-requests
//| file: src/frontend/controllers/PullRequests.tsx
import { useState } from "react";
import type { PullSummary } from "../api";
import { usePulls } from "../state/pulls";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { type PullChoice, PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

type Screen =
  | { phase: "browsing" }
  | { phase: "reviewing"; pull: number }
  | { phase: "picking"; pull: number };

export function PullRequests({ repo }: { repo: string }) {
  const pulls = usePulls(repo);
  const [screen, setScreen] = useState<Screen>({ phase: "browsing" });

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const choice = chosen(screen, pulls.data);

  return (
    <PullPanes
      choice={choice}
      onOpen={() => setScreen(openList)}
      onDismiss={() => setScreen(dismissList)}
      list={
        <PullList
          pulls={pulls.data}
          selected={choice.phase === "browsing" ? null : choice.pull.number}
          onSelect={(pull) => setScreen({ phase: "reviewing", pull })}
        />
      }
      review={
        choice.phase === "browsing" ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview key={choice.pull.number} repo={repo} pull={choice.pull} />
        )
      }
    />
  );
}

function chosen(screen: Screen, pulls: PullSummary[]): PullChoice {
  if (screen.phase === "browsing") return screen;
  const pull = pulls.find((candidate) => candidate.number === screen.pull);
  if (pull === undefined) return { phase: "browsing" };
  return { phase: screen.phase, pull };
}

function openList(screen: Screen): Screen {
  if (screen.phase !== "reviewing") return screen;
  return { phase: "picking", pull: screen.pull };
}

function dismissList(screen: Screen): Screen {
  if (screen.phase !== "picking") return screen;
  return { phase: "reviewing", pull: screen.pull };
}
```

## Row comparisons

Every row in the stack is a comparison between one commit and another, or a
commit on its own, and that comparison is the one thing on the row the
backend has to be asked for. `useRowDiffs` keys each fetch the same way
`stackRows` keys its rows, so an answer and the row that wants it agree on
which slot it belongs to without either side recomputing the other's key.

A card moving to a new slot only changes what surrounds it. The two commits
it names, and so the comparison behind it, do not change with it. Refetching
every row on every move would ask the backend the same question it already
answered, once per row, for no new information. `useRowDiffs` keeps every
answer it has fetched in a cache, keyed by slot, and only asks for a key it
has not seen. The cache clears when the repository, the pull request, or
either end of the comparison changes, because those are the only changes
that make an old answer wrong.

A request is asked once, so its answer has to land. Moving a card mid-flight
is exactly when a row is waiting on one, and an effect that discarded its
own requests on every move would leave that row loading for good. An answer
is dropped only when the comparison it was asked for is no longer the one
on screen, which `asked` records alongside the keys it has sent.

```tsx
//| id: frontend-state-row-diffs
//| file: src/frontend/state/rowDiffs.ts
import { useEffect, useRef, useState } from "react";
import {
  type FileDiff,
  fetchPullDiff,
  GitOid,
  type PullBaseline,
  type PullDiffScope,
} from "../api";
import type { AsyncState } from "./asyncState";
import type { Slot } from "./pairing";

/** The key a slot is addressed by. A fetched comparison and the row that
 *  shows it agree on this, so neither has to look the other up by anything
 *  else. */
export function slotKey(slot: Slot): string {
  return `${slot.left ?? ""}:${slot.right ?? ""}`;
}

function slotScope(slot: Slot): PullDiffScope | null {
  if (slot.left !== null && slot.right !== null) {
    return {
      kind: "pair",
      from: GitOid.parse(slot.left),
      to: GitOid.parse(slot.right),
    };
  }
  if (slot.right !== null) {
    return { kind: "commit", commit: GitOid.parse(slot.right) };
  }
  if (slot.left !== null) {
    return { kind: "commit", commit: GitOid.parse(slot.left) };
  }
  return null;
}

export type RowDiffs = Map<string, AsyncState<FileDiff[]>>;

const NO_DIFFS: RowDiffs = new Map();

/** The comparison behind each row, keyed the way a row is keyed. */
export function useRowDiffs(
  repo: string,
  number: number,
  from: PullBaseline,
  to: GitOid,
  slots: Slot[],
): RowDiffs {
  const of = `${repo}#${number}:${from.kind === "base" ? "base" : from.head}:${to}`;
  const [state, setState] = useState<{ of: string; cache: RowDiffs }>({
    of,
    cache: new Map(),
  });
  const asked = useRef<{ of: string; keys: Set<string> }>({
    of,
    keys: new Set(),
  });

  useEffect(() => {
    if (asked.current.of !== of) asked.current = { of, keys: new Set() };
    const { keys } = asked.current;

    for (const slot of slots) {
      const key = slotKey(slot);
      const scope = slotScope(slot);
      if (scope === null || keys.has(key)) continue;
      keys.add(key);

      const put = (value: AsyncState<FileDiff[]>) => {
        if (asked.current.of !== of) return;
        setState((now) => ({
          of,
          cache: new Map(now.of === of ? now.cache : []).set(key, value),
        }));
      };
      fetchPullDiff(repo, number, to, from, scope).then(
        (answer) => put({ status: "ready", data: answer.files }),
        (err: unknown) => put({ status: "error", message: String(err) }),
      );
    }
  }, [of, repo, number, from, to, slots]);

  return state.of === of ? state.cache : NO_DIFFS;
}
```

## Pull review controller

One pull request, head by head. The before end defaults to the base and the
after end to the latest head, so a pull request opens on what it introduces
against the branch it targets. That is the question a reviewer asks on
opening a pull request, and it replaces a defect the old default had: a pull
request with only one version used to compare that version against itself
and show an empty diff, because the before end also defaulted to a head.

The before end is a `PullBaseline` rather than a head, which is what the
[diff route](../backend/server.md) takes. The picker below hands one back
directly, so this controller passes what it is given straight through
instead of converting a head into a baseline itself.

The graph pane is where a reader corrects a guess. `usePairing` lives above
both panes in `PullReview`, but only `PairedGraph` gives the reader anything
to drag or nudge, so it is the one place a reorder can start. The diff pane
has no control of its own that lets a reader move a row. It only has rows to
show. Reading the pairing straight into `stackRows` keeps that direction one
way. A card moved in the graph changes which two commits a row compares, and
the diff pane draws whatever that turns out to be. It never happens the
other way round.

What the reader picks in the graph is a commit, not a row. Moving a card
renumbers the rows around it, and a picked index would then point at
whichever commit slid into its place.

A base comparison has one version on screen, not two, so there is nothing for
a graph to pair against. `usePairing` still runs against an empty before
side, because every hook downstream of it is called on every render no
matter which comparison is open, but its answer is the wrong shape to draw
there. Every row would read as added, which is true of nothing a reviewer
asked to see plain. `CommitLog` already draws one lane well, so a base
comparison keeps that lane and builds its stack rows straight from the
commit list instead of from a pairing with nothing on one side.

Only an open row draws its diff, so only an open row's files are handed to
[`useSources`](syntax.md#loading-each-side) to load. A stack of twenty commits
then costs nothing extra until someone opens one of them.

```tsx
//| id: frontend-controller-pull-review
//| file: src/frontend/controllers/PullReview.tsx
import { useState } from "react";
import type {
  FileDiff,
  GitCommit,
  GitOid,
  PullBaseline,
  PullSummary,
  PullVersion,
} from "../api";
import type { AsyncState } from "../state/asyncState";
import { type Slot, usePairing } from "../state/pairing";
import { usePullCommits } from "../state/pullCommits";
import { usePullHistory } from "../state/pullHistory";
import { type RowDiffs, slotKey, useRowDiffs } from "../state/rowDiffs";
import { useSources } from "../state/source";
import {
  CommitStack,
  type StackRow,
  type StackRowKind,
} from "../views/CommitStack";
import { Message } from "../views/Message";
import { PairedGraph } from "../views/PairedGraph";
import { PullComparisonPicker } from "../views/PullComparisonPicker";
import { PullHeader } from "../views/PullHeader";
import { PullReviewPanes } from "../views/PullPanes";
import { CommitLog } from "./CommitLog";

/** One array for every version that has not arrived. `usePairing` recomputes
 *  when its series change identity, so handing it a fresh `[]` each render
 *  would ask it to recompute forever. */
const NO_COMMITS: GitCommit[] = [];

/** A row whose comparison has not been asked for yet reads the same as one
 *  still waiting on it, because to the reader it is the same wait. */
const LOADING: AsyncState<FileDiff[]> = { status: "loading" };

function commitMap(commits: GitCommit[]): Map<string, GitCommit> {
  const map = new Map<string, GitCommit>();
  for (const commit of commits) map.set(commit.commitId, commit);
  return map;
}

/** The file `jj interdiff` writes a changed commit message into. */
const DESCRIPTION_FILE = "JJ-COMMIT-DESCRIPTION";

function pairedKind(files: AsyncState<FileDiff[]>): StackRowKind {
  // Nothing is known about a pair until its comparison lands, and a
  // comparison that failed says nothing either.
  if (files.status !== "ready") return "plain";
  const isMessage = (file: FileDiff) =>
    "path" in file && file.path === DESCRIPTION_FILE;
  if (!files.data.every(isMessage)) {
    return "amended";
  }
  return files.data.length > 0 ? "reworded" : "unchanged";
}

/** One row per slot. A slot with only one side is added or dropped. A slot
 *  with both sides is amended, reworded, or unchanged, by what the
 *  comparison behind it says once it lands. A slot naming a commit that is
 *  not actually in the list it points at is a bug, not a state, so it is
 *  skipped rather than given a row of its own. */
export function stackRows(
  slots: Slot[],
  before: GitCommit[],
  after: GitCommit[],
  diffs: RowDiffs,
): StackRow[] {
  const beforeById = commitMap(before);
  const afterById = commitMap(after);
  const rows: StackRow[] = [];

  for (const slot of slots) {
    const key = slotKey(slot);
    const files = diffs.get(key) ?? LOADING;

    if (slot.left === null) {
      if (slot.right === null) continue;
      const commit = afterById.get(slot.right);
      if (commit === undefined) continue;
      rows.push({ key, kind: "added", commit, was: null, files });
      continue;
    }

    if (slot.right === null) {
      const commit = beforeById.get(slot.left);
      if (commit === undefined) continue;
      rows.push({ key, kind: "dropped", commit, was: null, files });
      continue;
    }

    const commit = afterById.get(slot.right);
    const was = beforeById.get(slot.left);
    if (commit === undefined || was === undefined) continue;

    rows.push({
      key,
      kind: pairedKind(files),
      commit,
      was,
      files,
    });
  }

  return rows;
}

/** One row per commit in a base comparison, always plain. There is no older
 *  version behind a base comparison, so added, dropped, and amended would
 *  each claim a history this comparison does not have. */
export function baseStackRows(after: GitCommit[], diffs: RowDiffs): StackRow[] {
  return after.map((commit) => {
    const key = slotKey({ left: null, right: commit.commitId });
    return {
      key,
      kind: "plain" as const,
      commit,
      was: null,
      files: diffs.get(key) ?? LOADING,
    };
  });
}

function versionName(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? "?" : `v${state.version}`;
}

function versionLabel(states: PullVersion[], head: GitOid): string {
  return `${versionName(states, head)} · ${head.slice(0, 7)}`;
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function PullReview({
  repo,
  pull,
}: {
  repo: string;
  pull: PullSummary;
}) {
  const history = usePullHistory(repo, pull.number);
  const [from, setFrom] = useState<PullBaseline>({ kind: "base" });
  const [pickedTo, setPickedTo] = useState<GitOid | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);

  const latest =
    history.status === "ready" ? history.data.states.at(-1) : undefined;
  const beforeHead = from.kind === "version" ? from.head : null;
  // Falls back to the pull's own head so there is always a real oid to read
  // here, even on the render before the history request comes back. Every
  // hook below runs on every render, loading or not, so there is no point
  // in this function where "not loaded yet" can mean "call fewer hooks".
  const to = pickedTo ?? latest?.head ?? pull.headRefOid;
  const number = pull.number;

  const beforeState = usePullCommits(repo, number, beforeHead);
  const afterState = usePullCommits(repo, number, to);
  const beforeCommits =
    beforeState.status === "ready" ? beforeState.data : NO_COMMITS;
  const afterCommits =
    afterState.status === "ready" ? afterState.data : NO_COMMITS;

  const pairing = usePairing(beforeCommits, afterCommits);
  const diffs = useRowDiffs(repo, number, from, to, pairing.slots);
  const sources = useSources(
    [...open].flatMap((key) => {
      const files = diffs.get(key);
      return files?.status === "ready" ? files.data : [];
    }),
  );

  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }
  if (latest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const rows =
    from.kind === "base"
      ? baseStackRows(afterCommits, diffs)
      : stackRows(pairing.slots, beforeCommits, afterCommits, diffs);

  const commitsLoading =
    beforeState.status === "loading" || afterState.status === "loading";
  const commitsError =
    beforeState.status === "error"
      ? beforeState.message
      : afterState.status === "error"
        ? afterState.message
        : null;

  const currentKey =
    rows.find(
      (row) => row.commit.commitId === current || row.was?.commitId === current,
    )?.key ?? null;

  return (
    <PullReviewPanes
      header={<PullHeader pull={pull} />}
      picker={
        <PullComparisonPicker
          history={history.data}
          from={from}
          to={to}
          onPickFrom={setFrom}
          onPickTo={setPickedTo}
        />
      }
      commits={
        commitsError !== null ? (
          <Message tone="error">{commitsError}</Message>
        ) : commitsLoading ? (
          <Message>Loading commits...</Message>
        ) : from.kind === "version" ? (
          <PairedGraph
            before={beforeCommits}
            after={afterCommits}
            pairing={pairing}
            beforeLabel={versionLabel(history.data.states, from.head)}
            afterLabel={versionLabel(history.data.states, to)}
            current={current}
            onSelect={setCurrent}
          />
        ) : (
          <CommitLog
            source={{ kind: "pull", repo, number, head: to }}
            selected={[]}
            oldestFirst
          />
        )
      }
      diff={
        commitsError !== null ? (
          <Message tone="error">{commitsError}</Message>
        ) : commitsLoading ? (
          <Message>Loading commits...</Message>
        ) : (
          <CommitStack
            rows={rows}
            sources={sources}
            open={open}
            onToggle={(key) => setOpen((now) => toggled(now, key))}
            expanded={expanded}
            onExpand={(key) => setExpanded((now) => toggled(now, key))}
            current={currentKey}
            since={
              from.kind === "version"
                ? versionName(history.data.states, from.head)
                : "the base"
            }
          />
        )
      }
    />
  );
}
```

## Tests

`stackRows` and `baseStackRows` carry every branching decision in this
screen, so they are what gets pinned, the way `heuristicSlots` is pinned in
[pairing.md](pairing.md) without rendering anything.

```ts
//| id: frontend-controller-pull-review-test
//| file: src/frontend/controllers/PullReview.test.ts
import { describe, expect, test } from "bun:test";
import { type FileDiff, type GitCommit, GitOid } from "../api";
import type { AsyncState } from "../state/asyncState";
import type { Slot } from "../state/pairing";
import { baseStackRows, stackRows } from "./PullReview";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function commit(ch: string, description: string): GitCommit {
  return {
    commitId: oid(ch),
    parents: [],
    description,
    author: "someone@example.com",
    authoredAt: "2026-01-01T00:00:00Z",
    changeId: null,
  };
}

describe("stackRows", () => {
  test("gives an added row to a slot with nothing on the old side", () => {
    // arrange
    const added = commit("b", "add a thing");
    const slots: Slot[] = [{ left: null, right: added.commitId }];
    const diffs = new Map<string, AsyncState<FileDiff[]>>();

    // act
    const rows = stackRows(slots, [], [added], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `:${added.commitId}`,
        kind: "added",
        commit: added,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });

  test("gives a dropped row to a slot with nothing on the new side", () => {
    // arrange
    const dropped = commit("a", "remove a thing");
    const slots: Slot[] = [{ left: dropped.commitId, right: null }];
    const diffs = new Map<string, AsyncState<FileDiff[]>>();

    // act
    const rows = stackRows(slots, [dropped], [], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `${dropped.commitId}:`,
        kind: "dropped",
        commit: dropped,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });

  test("reads a paired slot as amended when the comparison finds a diff", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "@@ -1 +1 @@\n-a\n+b",
      },
    ];
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: files }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows).toEqual([
      {
        key,
        kind: "amended",
        commit: now,
        was,
        files: { status: "ready", data: files },
      },
    ]);
  });

  test("reads a paired slot as unchanged when the comparison is empty", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: [] }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("unchanged");
  });

  test("reads a paired slot as reworded when only the message moved", () => {
    // arrange
    const was = commit("a", "old subject");
    const now = commit("b", "new subject");
    const key = `${was.commitId}:${now.commitId}`;
    const message: FileDiff = {
      status: "modified",
      path: "JJ-COMMIT-DESCRIPTION",
      binary: false,
      oldBlob: null,
      newBlob: null,
      patch: "@@ -1 +1 @@\n-old subject\n+new subject",
    };
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: [message] }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("reworded");
  });

  test("reads a paired slot as amended when the message and the code both moved", () => {
    // arrange
    const was = commit("a", "old subject");
    const now = commit("b", "new subject");
    const key = `${was.commitId}:${now.commitId}`;
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "JJ-COMMIT-DESCRIPTION",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "@@ -1 +1 @@\n-old subject\n+new subject",
      },
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "@@ -1 +1 @@\n-a\n+b",
      },
    ];
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "ready", data: files }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("amended");
  });

  test("reads a paired slot as plain while its comparison is still loading", () => {
    // arrange
    const was = commit("a", "subject");
    const now = commit("b", "subject");
    const key = `${was.commitId}:${now.commitId}`;
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [key, { status: "loading" }],
    ]);
    const slots: Slot[] = [{ left: was.commitId, right: now.commitId }];

    // act
    const rows = stackRows(slots, [was], [now], diffs);

    // assert
    expect(rows[0]?.kind).toBe("plain");
  });
});

describe("baseStackRows", () => {
  test("gives one plain row per commit, keyed the way a slot with no old side is", () => {
    // arrange
    const one = commit("a", "first");
    const two = commit("b", "second");
    const diffs = new Map<string, AsyncState<FileDiff[]>>([
      [`:${one.commitId}`, { status: "ready", data: [] }],
    ]);

    // act
    const rows = baseStackRows([one, two], diffs);

    // assert
    expect(rows).toEqual([
      {
        key: `:${one.commitId}`,
        kind: "plain",
        commit: one,
        was: null,
        files: { status: "ready", data: [] },
      },
      {
        key: `:${two.commitId}`,
        kind: "plain",
        commit: two,
        was: null,
        files: { status: "loading" },
      },
    ]);
  });
});
```

## Pull request list

One row per pull request: its number, its state, its title, and the branch it
targets. The base branch is there because a pull request against a release
branch and one against `main` read differently, and the number alone does not
say which this is.

```tsx
//| id: frontend-view-pull-list
//| file: src/frontend/views/PullList.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullList({
  pulls,
  selected,
  onSelect,
}: {
  pulls: PullSummary[];
  selected: number | null;
  onSelect: (number: number) => void;
}) {
  return (
    <div>
      {pulls.map((pull) => (
        <button
          type="button"
          key={pull.number}
          onClick={() => onSelect(pull.number)}
          className={
            pull.number === selected
              ? "pull-list__item pull-list__item--selected"
              : "pull-list__item"
          }
        >
          <span className="pull-list__row">
            <span className="pull-list__number">#{pull.number}</span>
            <PullStateChip state={pull.state} />
          </span>
          <span className="pull-list__title">{pull.title}</span>
          <span className="pull-list__base">← {pull.baseRefName}</span>
        </button>
      ))}
    </div>
  );
}
```

PullList renders each pull request as a full-width button standing in for
a row, and the selected one takes the same selection colour a picked commit
gets in the graph.

```css
/*| id: design-pull-list
@layer components {
  .pull-list__item {
    display: block;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
  }

  .pull-list__item--selected {
    background: var(--surface-selected);
  }

  .pull-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .pull-list__number {
    color: var(--text-faint);
  }

  .pull-list__title {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pull-list__base {
    color: var(--text-faint);
  }
}
```

A title is how a pull request is told from the others in the list, and the
part that tells them apart is rarely in the first thirty characters. On a
narrow screen it wraps onto as many lines as it needs.

```css
/*| id: design-pull-list
@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-list__title {
      white-space: normal;
      overflow: visible;
    }
  }
}
```

## Pull request header

What is being read, on one line, including a link out to GitHub. The link is
there because half of reviewing a pull request is the conversation on it, and
this tool does not show conversations.

```tsx
//| id: frontend-view-pull-header
//| file: src/frontend/views/PullHeader.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullHeader({ pull }: { pull: PullSummary }) {
  return (
    <header className="pull-header">
      <span className="pull-header__meta">#{pull.number}</span>
      <strong className="pull-header__title">{pull.title}</strong>
      <PullStateChip state={pull.state} />
      <span className="pull-header__meta">base: {pull.baseRefName}</span>
      <span className="pull-header__meta">{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        className="pull-header__link"
      >
        github
      </a>
    </header>
  );
}
```

PullHeader is a strip of small facts about a pull request, and the number,
the base branch, and the author share one muted style since none of them
outranks the others.

```css
/*| id: design-pull-header
@layer components {
  .pull-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-3) var(--space-5);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
  }

  .pull-header__title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pull-header__meta {
    color: var(--text-faint);
  }

  .pull-header__link {
    color: var(--accent);
  }
}
```

One line is what a desk has the width for. A phone does not, so the strip
wraps and the title, the longest string on it, takes a row of its own above
the small facts. That spends height, which a phone has, to stop spending
width, which it has not.

```css
/*| id: design-pull-header
@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-header {
      flex-wrap: wrap;
      row-gap: var(--space-2);
      white-space: normal;
      overflow: visible;
    }

    .pull-header__title {
      flex-basis: 100%;
      overflow: visible;
    }
  }
}
```

## Pull comparison picker

Two native `<select>`s, one per end of the comparison, each wrapped in a
`<label>` with a visible text caption. [`OperationPicker`](local-history.md)
is the only other place in the app that reaches for a native select, and this
follows its shape: a label naming the field, a select whose `value` is looked
up rather than trusted, and `onChange` turning the chosen option back into a
real value before it leaves the component.

A native select is the right control for a phone as well as a desktop. A
touch browser renders it as a full-screen list a reader taps through, and it
is keyboard- and screen-reader-complete with no work of its own.

The "from" select offers the base branch tip alongside every version; the
"to" select offers versions only. The base as the after end is the pull
request read backwards, which nobody reads, and the commit strip beside the
diff takes `to` as a head with nothing to draw for a base. That asymmetry is
why the component takes `from: PullBaseline` and `to: GitOid` rather than a
matched pair.

Each option is one line: `base (main @ a1b2c3d)` for the base, and
`v3 (c3d4e5f, force-pushed 2024-05-01)` for a version, built from its
position in the chain, its short oid, and how it became the head. A version
option is never picked by casting `event.target.value`, a DOM string, to a
`GitOid`. It is looked up in `history.states` instead, and the branded oid
that was already there is handed back; a value matching nothing is a bug,
and it throws rather than inventing an oid.

`PullHistory.truncated` is true when the branch was force-pushed more times
than one page of GitHub's history holds, so the middle of the chain is
missing and the version numbers this component labels options with are
positions among the states that survived, not actual push counts. A dropdown
hides that gap worse than a row of chips would have, since a collapsed list
gives no visual hint that anything is missing, so a short note says a gap
exists. GitHub's own history does not say where the gap is, only that there
is one, so the note does not try to mark it between two options either.

The caption matters more here than the chip row's caption did, because the
two selects name which versions are being compared but not which kind of
comparison is on screen. Base against a head is a tree diff of content;
version against version is a diff of diffs. Those answer different
questions, and [the backend route](../backend/server.md) refused to offer a
second comparison here for exactly as long as it would have gone unlabelled.
The caption is what discharges that objection, so it is load-bearing rather
than decoration.

```tsx
//| id: frontend-view-pull-comparison-picker
//| file: src/frontend/views/PullComparisonPicker.tsx
import type {
  GitOid,
  PullBaseline,
  PullHeadOrigin,
  PullHistory,
  PullVersion,
} from "../api";

export function PullComparisonPicker({
  history,
  from,
  to,
  onPickFrom,
  onPickTo,
}: {
  history: PullHistory;
  from: PullBaseline;
  to: GitOid;
  onPickFrom: (from: PullBaseline) => void;
  onPickTo: (head: GitOid) => void;
}) {
  const { states, baseRefName, baseRefOid, truncated } = history;

  return (
    <div className="pull-compare">
      <label className="pull-compare__field">
        <span className="pull-compare__label">from</span>
        <select
          value={from.kind === "base" ? "base" : from.head}
          onChange={(event) =>
            onPickFrom(parseBaseline(event.target.value, states))
          }
          className="pull-compare__select"
        >
          <option value="base">{`base (${baseRefName} @ ${baseRefOid.slice(0, 7)})`}</option>
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      <label className="pull-compare__field">
        <span className="pull-compare__label">to</span>
        <select
          value={to}
          onChange={(event) => onPickTo(lookupHead(event.target.value, states))}
          className="pull-compare__select"
        >
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      {truncated ? (
        <p className="pull-compare__truncated">
          Some versions are missing here. This pull request was force-pushed
          more times than GitHub's history holds, and it does not say which ones
          were lost.
        </p>
      ) : null}
      <p className="pull-compare__caption">
        {caption(states, baseRefName, from, to)}
      </p>
    </div>
  );
}

function parseBaseline(value: string, states: PullVersion[]): PullBaseline {
  if (value === "base") return { kind: "base" };
  return { kind: "version", head: lookupHead(value, states) };
}

function lookupHead(value: string, states: PullVersion[]): GitOid {
  const state = states.find((candidate) => candidate.head === value);
  if (state === undefined) {
    throw new Error(`no version of this pull request has head ${value}`);
  }
  return state.head;
}

function versionLabel(state: PullVersion): string {
  return `v${state.version} (${state.head.slice(0, 7)}, ${when(state.origin)})`;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") {
    return `force-pushed ${origin.at.slice(0, 10)}`;
  }
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(
  states: PullVersion[],
  baseRefName: string,
  from: PullBaseline,
  to: GitOid,
): string {
  if (from.kind === "base") {
    return `what ${label(states, to)} adds to ${baseRefName}`;
  }
  if (from.head === to) {
    return `${label(states, to)} against itself`;
  }
  return `what changed between ${label(states, from.head)} and ${label(states, to)}`;
}
```

A reader loses something real here. A row of chips names both ends of the
whole force-push history at a glance; two dropdowns hide that history behind
a list a reader has to open and count through. The change is made anyway,
because a picker a phone cannot operate is not a picker. Shift-click has no
touch equivalent, so a reader on a phone could move the after end and never
the before end, which is a control that only half works for part of its
audience.

`PullComparisonPicker` is two labelled selects and two caption lines, so
`.pull-compare` is the flex row that holds all four and the rest of the
classes only line each part up. `flex-wrap: wrap` on that row is what lets
the two fields sit side by side on a wide screen and drop to a stack on a
phone, and `min-height: 44px` on the select is the standard minimum touch
target size (WCAG 2.5.5), which a desktop pointer never notices. `min-width:
0` on the field and the select keeps a long option label from forcing the
row wider than its column, the same problem a text-overflow ellipsis solves
elsewhere in this app.

```css
/*| id: design-pull-comparison-picker
@layer components {
  .pull-compare {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .pull-compare__field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .pull-compare__label {
    color: var(--text-faint);
  }

  .pull-compare__select {
    min-height: 44px;
    min-width: 0;
    font: inherit;
  }

  .pull-compare__caption {
    flex: 1 0 100%;
    margin: 0;
    color: var(--text-faint);
  }

  .pull-compare__truncated {
    flex: 1 0 100%;
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-size-small);
  }
}
```

## Pull request state chip

A pull request is open, merged or closed, and a reader scanning a list should
tell which at a glance rather than by reading the word. One component, so the
list and the header colour them the same.

```tsx
//| id: frontend-view-pull-state-chip
//| file: src/frontend/views/PullStateChip.tsx
import type { PullState } from "../api";

const CHIP_CLASS: Record<PullState, string> = {
  OPEN: "chip--open",
  MERGED: "chip--merged",
  CLOSED: "chip--closed",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span className={`chip ${CHIP_CLASS[state]}`}>{state.toLowerCase()}</span>
  );
}
```

Three states and nothing else, so the chip is `.chip` plus one modifier each
rather than a colour keyed by string. `--state-open`, `--state-merged`, and
`--state-closed` are the only place those three colours are written down.

```css
/*| id: design-pull-state-chip
@layer components {
  .chip {
    flex: none;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    color: var(--text-inverse);
    font-size: var(--text-size-small);
  }

  .chip--open {
    background: var(--state-open);
  }

  .chip--merged {
    background: var(--state-merged);
  }

  .chip--closed {
    background: var(--state-closed);
  }
}
```
