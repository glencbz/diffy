# Pull requests

The screen that reviews a pull request, each side pinned to a head the
branch has had.

## Loading the list and one pull's heads

`usePulls` lists pull requests in every state, since a merged one that was
force-pushed is exactly the history worth reading back. The repository is
whichever one the server's `origin` names.

```tsx
//| id: frontend-state-pulls
//| file: src/frontend/state/pulls.ts
import { useEffect, useState } from "react";
import { fetchPulls, fetchRepo } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { PullSummary } from "../model/pull";

export interface RepoPulls {
  /** `owner/name`, as the server read it off `origin`. */
  repo: string;
  pulls: PullSummary[];
}

export function usePulls(): AsyncState<RepoPulls> {
  const [state, setState] = useState<AsyncState<RepoPulls>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    fetchRepo()
      .then(async (repo) => ({ repo, pulls: await fetchPulls(repo, "all") }))
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
```

```tsx
//| id: frontend-state-pull-history
//| file: src/frontend/state/pullHistory.ts
import { useEffect, useState } from "react";
import { fetchPullHistory } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { PullHistory } from "../model/pull";

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

`useCommits` maps pull request commits to `LogEntry` with a null `changeId`,
so the pairing reads `usePullCommits` instead, which keeps the subject-line
guess. It also reverses the list so the pairing, the paired graph, and the
stack all read oldest first, the order a series is meant to be read in.

```tsx
//| id: frontend-state-pull-commits
//| file: src/frontend/state/pullCommits.ts
import { useEffect, useState } from "react";
import { fetchPullCommits } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { GitCommit, GitOid } from "../model/history";

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
## The head last reviewed

A second visit should start on what moved since the last. The review
document keeps every head the reader marked reviewed under
`pull:<repo>#<number>`, and a bare pull request address opens on the
comparison from the newest marked head the history still lists to the latest.
Marking is explicit: inferring it from what was on screen would treat a
glance at the title as a review and hide everything after it. `LastReviewed`,
the shape the browser used to keep, stays for the
[import](review.md#moving-what-the-browser-kept).

```ts
//| id: frontend-model-last-reviewed
//| file: src/frontend/model/lastReviewed.ts
import * as z from "zod";
import { GitOid } from "./history";
import type { PullPlace } from "./place";
import type { PullVersion } from "./pull";
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
```

Only a bare address takes the remembered default; any head, commit, or file
in it wins. The since-review comparison is not written into the address,
which still means "this pull request at its default". A remembered head that
is the latest, or that the history no longer lists (a fast-forward moved
past it, or the chain was truncated), opens the pull request whole, the
latter with a note.

```ts
//| id: frontend-model-last-reviewed
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
```

```ts
//| id: frontend-model-last-reviewed-test
//| file: src/frontend/model/lastReviewed.test.ts
import { describe, expect, test } from "bun:test";
import { GitOid } from "./history";
import { lastReviewed, opening } from "./lastReviewed";
import { openPull, type PullPlace } from "./place";
import type { PullVersion } from "./pull";
import type { ReviewedVersion } from "./review";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function version(n: number, ch: string): PullVersion {
  return { version: n, head: oid(ch), origin: { kind: "opened" } };
}

describe("opening", () => {
  const states = [version(1, "a"), version(2, "b"), version(3, "c")];

  test("opens a bare address on the changes since the head last reviewed", () => {
    expect(opening(openPull(7), oid("a"), states)).toEqual({
      number: 7,
      from: { kind: "version", head: oid("a") },
      to: null,
      spot: null,
    });
  });

  test("opens whole when nothing was reviewed", () => {
    expect(opening(openPull(7), null, states)).toEqual(openPull(7));
  });

  test("opens whole when the latest head is the one reviewed", () => {
    expect(opening(openPull(7), oid("c"), states)).toEqual(openPull(7));
  });

  test("opens whole when the head reviewed is no longer in the history", () => {
    expect(opening(openPull(7), oid("f"), states)).toEqual(openPull(7));
  });

  test("leaves an address that names anything past the number alone", () => {
    const places: PullPlace[] = [
      { ...openPull(7), to: oid("c") },
      { ...openPull(7), from: { kind: "version", head: oid("b") } },
      { ...openPull(7), to: oid("c"), spot: { commit: oid("d"), file: null } },
    ];

    for (const place of places) {
      expect(opening(place, oid("a"), states)).toEqual(place);
    }
  });
});

describe("lastReviewed", () => {
  const states = [version(1, "a"), version(2, "b"), version(3, "c")];

  function mark(ch: string, reviewedAt: string): ReviewedVersion {
    return { series: "pull:o/r#7", version: oid(ch), reviewedAt };
  }

  test("takes the newest head marked, whenever it was marked", () => {
    // arrange
    const marked = [mark("b", "t1"), mark("a", "t2")];

    // act
    // assert
    expect(lastReviewed(marked, states)).toBe(oid("b"));
  });

  test("takes the head marked last when the history lists none", () => {
    // arrange
    const marked = [mark("e", "t2"), mark("f", "t1")];

    // act
    // assert
    expect(lastReviewed(marked, states)).toBe(oid("e"));
  });

  test("reads nothing reviewed when nothing is marked", () => {
    expect(lastReviewed([], states)).toBeNull();
  });
});
```

`LastReviewed` names the head last reviewed when the comparison starts there
and ends on the latest, says when that head is gone, and holds the "Mark
reviewed" button for the after end. Marking pins the comparison into the
address, or the default would jump to the whole pull request as soon as the
latest head is marked.

```tsx
//| id: frontend-view-last-reviewed
//| file: src/frontend/views/LastReviewed.tsx
import type { GitOid } from "../model/history";
import type { PullBaseline, PullVersion } from "../model/pull";

export function LastReviewed({
  states,
  reviewed,
  from,
  to,
  toMarked,
  onMark,
  onWhole,
}: {
  states: PullVersion[];
  reviewed: GitOid | null;
  from: PullBaseline;
  to: GitOid;
  /** Whether the reader has marked the after head reviewed. */
  toMarked: boolean;
  /** Null when there is no review document to write to. */
  onMark: (() => void) | null;
  onWhole: () => void;
}) {
  const known = states.find((state) => state.head === reviewed);
  const since =
    known !== undefined &&
    from.kind === "version" &&
    from.head === known.head &&
    to === states.at(-1)?.head;

  return (
    <div className="last-reviewed">
      {since ? (
        <>
          <p className="last-reviewed__note">
            Showing what changed since v{known.version}, the head you last
            reviewed.
          </p>
          <button
            type="button"
            className="last-reviewed__action"
            onClick={onWhole}
          >
            Show the whole pull request
          </button>
        </>
      ) : reviewed !== null && known === undefined ? (
        <p className="last-reviewed__note">
          You last reviewed {reviewed.slice(0, 7)}, which this pull request's
          history no longer lists, so it opens whole.
        </p>
      ) : null}
      {(toMarked || onMark !== null) && (
        <button
          type="button"
          className="last-reviewed__action"
          onClick={onMark ?? undefined}
          disabled={toMarked}
        >
          {toMarked
            ? `Reviewed at ${name(states, to)}`
            : `Mark reviewed at ${name(states, to)}`}
        </button>
      )}
    </div>
  );
}

function name(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}
```

```css
/*| id: design-last-reviewed
@layer components {
  .last-reviewed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .last-reviewed__note {
    flex: 1 1 auto;
    margin: 0;
  }

  .last-reviewed__action {
    min-height: 44px;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .last-reviewed__action:disabled {
    color: var(--text-faint);
    cursor: default;
  }
}
```

## The screen

```tsx
//| id: frontend-screen-pull-requests
//| file: src/frontend/screens/PullRequestsScreen.tsx
import { PullRequests } from "../controllers/PullRequests";
import { type Place, type PullPlace, tabPlace } from "../model/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function PullRequestsScreen({
  place,
  onGo,
}: {
  place: PullPlace | null;
  onGo: (place: Place) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode="pulls"
        onSelect={(mode) => {
          if (mode !== "pulls") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      <PullRequests
        place={place}
        review={review}
        onGo={(pull) => onGo({ tab: "pulls", pull })}
      />
    </div>
  );
}
```

## Pull requests controller

The pull request number arrives in a `PullPlace` and picks go up through
`onGo`; the rest of the place passes to `PullReview`. Whether the list is
open over a review is not in the address, since it is window state. It is
held as the number of the pull request it was opened over, so navigating
elsewhere folds it with nothing to close. Picking the open pull request keeps
its place; picking another opens it at base against latest, and
`PullReview` is keyed by number so its own state starts over.

```tsx
//| id: frontend-controller-pull-requests
//| file: src/frontend/controllers/PullRequests.tsx
import { useState } from "react";
import { openPull, type PullPlace } from "../model/place";
import type { PullSummary } from "../model/pull";
import { usePulls } from "../state/pulls";
import type { ReviewHandle } from "../state/review";
import { Message } from "../views/Message";
import { PullList } from "../views/PullPanes/PullList";
import { type PullChoice, PullPanes } from "../views/PullPanes/PullPanes";
import { PullReview } from "./PullReview";

export function PullRequests({
  place,
  review,
  onGo,
}: {
  place: PullPlace | null;
  review: ReviewHandle;
  onGo: (place: PullPlace | null) => void;
}) {
  const pulls = usePulls();
  const [sheetOver, setSheetOver] = useState<number | null>(null);

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const { repo } = pulls.data;
  const choice = chosen(place, sheetOver, pulls.data.pulls);

  return (
    <PullPanes
      choice={choice}
      onOpen={() => setSheetOver(place?.number ?? null)}
      onDismiss={() => setSheetOver(null)}
      list={
        <PullList
          pulls={pulls.data.pulls}
          selected={choice.phase === "browsing" ? null : choice.pull.number}
          onSelect={(number) => {
            setSheetOver(null);
            onGo(number === place?.number ? place : openPull(number));
          }}
        />
      }
      review={
        choice.phase === "browsing" || place === null ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview
            key={choice.pull.number}
            repo={repo}
            pull={choice.pull}
            place={place}
            review={review}
            onGo={onGo}
          />
        )
      }
    />
  );
}

function chosen(
  place: PullPlace | null,
  sheetOver: number | null,
  pulls: PullSummary[],
): PullChoice {
  if (place === null) return { phase: "browsing" };
  const pull = pulls.find((candidate) => candidate.number === place.number);
  // A typed or outdated number falls back to browsing, the one screen a
  // reader can act on.
  if (pull === undefined) return { phase: "browsing" };
  return { phase: sheetOver === pull.number ? "picking" : "reviewing", pull };
}
```

## Row comparisons

`useRowDiffs` fetches each row's comparison keyed like `stackRows` keys its
rows, and caches by slot: moving a card changes what surrounds it, not what
it compares. The cache clears only when the repository, pull request, or
either end changes.

```tsx
//| id: frontend-state-row-diffs
//| file: src/frontend/state/rowDiffs.ts
import { useEffect, useRef, useState } from "react";
import { fetchPullDiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import { GitOid } from "../model/history";
import type { Slot } from "../model/pairing";
import type { PullBaseline, PullDiffScope } from "../model/pull";

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
  // Each key is asked once, so its answer must land even if a card moved
  // meanwhile; it is dropped only when the comparison itself changed.
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

## Whole pull request

The whole pull request's size cannot be summed from rows (a file two commits
touch would count twice), so `usePullFiles` asks for the after head against
the merge base, what the pull request would land. It follows the after end
alone, whatever the before end is.

```tsx
//| id: frontend-state-pull-files
//| file: src/frontend/state/pullFiles.ts
import { useEffect, useState } from "react";
import { fetchPullDiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import type { GitOid } from "../model/history";

/** Every file one version changes against its base, as the pull request
 *  would land it. */
export function usePullFiles(
  repo: string,
  number: number,
  head: GitOid,
): AsyncState<FileDiff[]> {
  const [state, setState] = useState<AsyncState<FileDiff[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;

    setState({ status: "loading" });
    fetchPullDiff(repo, number, head, { kind: "base" }, { kind: "heads" })
      .then((data) => {
        if (live) setState({ status: "ready", data: data.files });
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

## Pull review controller

The before end defaults to the base and the after end to the latest head, so
a pull request opens on what it introduces.

The pairing flows one way: only `PairedGraph` can move a card, and
`stackRows` reads the pairing, so the diff pane draws whatever the graph
decided. A pick is a commit, not a row index, since a move renumbers rows. A
base comparison has nothing to pair, so it draws `CommitLog`'s single lane and
builds rows from the commit list; `usePairing` still runs, since hooks run on
every render, but its all-added answer goes unused.

Each row is reviewed under the key [`pullRowKey`](review.md#review-state)
gives its two commits, so a hand-paired card carries its marks and comments.
Only open rows hand their files to
[`useSources`](syntax.md#loading-each-side).

The ends, picked commit, file, and line come from the address; open rows and
expanded messages are local state, except that a linked file's row opens.
Moving the before end keeps the picked commit, moving the after end drops it.
The stack scrolls on a graph pick or an arrival from back/forward
(`reveal`), never on a click in the diff. The [drawer's bar](layout.md#the-commit-drawer)
steps by calling `pick`, so a step is a pick in every respect. The place used
is the one [`opening`](#the-head-last-reviewed) resolves, so picks in a
since-review comparison keep its before end.

```tsx
//| id: frontend-controller-pull-review
//| file: src/frontend/controllers/PullReview.tsx
import { useEffect, useState } from "react";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import type { GitCommit, GitOid } from "../model/history";
import { lastReviewed, opening } from "../model/lastReviewed";
import type { Slot } from "../model/pairing";
import {
  type FileSpot,
  openPull,
  type PullPlace,
  pullHref,
} from "../model/place";
import type { PullSummary, PullVersion } from "../model/pull";
import {
  type ComparisonReview,
  keptPairing,
  pullRowKey,
  pullSeries,
  reviewComparison,
  reviewedIn,
} from "../model/review";
import { usePairing } from "../state/pairing";
import { usePaneSizes } from "../state/paneSizes";
import { useArrivals } from "../state/place";
import { usePullCommits } from "../state/pullCommits";
import { usePullFiles } from "../state/pullFiles";
import { usePullHistory } from "../state/pullHistory";
import type { ReviewHandle } from "../state/review";
import { type RowDiffs, slotKey, useRowDiffs } from "../state/rowDiffs";
import { useSettingsContext } from "../state/settings";
import { useSources } from "../state/source";
import {
  CommitStack,
  type StackRow,
  type StackRowKind,
} from "../views/CommitStack";
import type { DiffLinks } from "../views/DiffView/DiffView";
import { LastReviewed } from "../views/LastReviewed";
import { Message } from "../views/Message";
import { PairedGraph } from "../views/PairedGraph";
import { PullComparisonPicker } from "../views/PullPanes/PullReviewPanes/PullComparisonPicker";
import { PullHeader } from "../views/PullPanes/PullReviewPanes/PullHeader";
import { PullReviewPanes } from "../views/PullPanes/PullReviewPanes/PullReviewPanes";
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

/** The commit a click on the single-lane graph picked, read off the
 *  selection it hands back. A click on the current commit toggles it out of
 *  that selection, and still means that commit. */
function pickedFrom(selection: string[], current: string | null): string {
  return selection.find((id) => id !== current) ?? current ?? "";
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
  place: asked,
  review,
  onGo,
}: {
  repo: string;
  pull: PullSummary;
  place: PullPlace;
  review: ReviewHandle;
  onGo: (place: PullPlace) => void;
}) {
  const history = usePullHistory(repo, pull.number);
  const { display } = useSettingsContext().settings;
  const series = pullSeries(repo, pull.number);
  const marked = reviewedIn(review.document, series);
  const reviewed = lastReviewed(
    marked,
    history.status === "ready" ? history.data.states : [],
  );
  const place = opening(
    asked,
    reviewed,
    history.status === "ready" ? history.data.states : [],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [picks, setPicks] = useState(0);
  const [sizes, resize] = usePaneSizes();
  const arrivals = useArrivals();
  const { from, spot } = place;
  const current = spot?.commit ?? null;

  const latest =
    history.status === "ready" ? history.data.states.at(-1) : undefined;
  const beforeHead = from.kind === "version" ? from.head : null;
  // Falls back to the pull's own head so there is always a real oid to read
  // here, even on the render before the history request comes back. Every
  // hook below runs on every render, loading or not, so there is no point
  // in this function where "not loaded yet" can mean "call fewer hooks".
  const to = place.to ?? latest?.head ?? pull.headRefOid;
  const number = pull.number;

  const beforeState = usePullCommits(repo, number, beforeHead);
  const afterState = usePullCommits(repo, number, to);
  const beforeCommits =
    beforeState.status === "ready" ? beforeState.data : NO_COMMITS;
  const afterCommits =
    afterState.status === "ready" ? afterState.data : NO_COMMITS;

  const pullFiles = usePullFiles(repo, number, to);
  const pairingHeads =
    beforeHead === null ? null : { series, before: beforeHead, after: to };
  const pairing = usePairing(
    beforeCommits,
    afterCommits,
    pairingHeads === null || review.status !== "ready"
      ? null
      : {
          slots: keptPairing(review.document, pairingHeads),
          keep: (slots) =>
            review.actions.keepPairing(
              series,
              pairingHeads.before,
              pairingHeads.after,
              slots,
            ),
        },
  );
  const diffs = useRowDiffs(repo, number, from, to, pairing.slots);
  const sources = useSources(
    [...open].flatMap((key) => {
      const files = diffs.get(key);
      return files?.status === "ready" ? files.data : [];
    }),
  );

  const rows =
    from.kind === "base"
      ? baseStackRows(afterCommits, diffs)
      : stackRows(pairing.slots, beforeCommits, afterCommits, diffs);

  const currentIndex = rows.findIndex(
    (row) => row.commit.commitId === current || row.was?.commitId === current,
  );
  const currentRow = rows[currentIndex];
  const currentKey = currentRow?.key ?? null;

  // A file in the address is a file on screen, so the row it is in opens,
  // on arrival and whenever back or forward lands on another one.
  const fileKey = spot === null || spot.file === null ? null : currentKey;
  useEffect(() => {
    if (fileKey === null) return;
    setOpen((now) => (now.has(fileKey) ? now : new Set(now).add(fileKey)));
  }, [fileKey]);

  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }
  if (latest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const commitsLoading =
    beforeState.status === "loading" || afterState.status === "loading";
  const commitsError =
    beforeState.status === "error"
      ? beforeState.message
      : afterState.status === "error"
        ? afterState.message
        : null;

  const pick = (commitId: string) => {
    const commit =
      afterCommits.find((candidate) => candidate.commitId === commitId) ??
      beforeCommits.find((candidate) => candidate.commitId === commitId);
    if (commit === undefined) return;
    onGo({ ...place, to, spot: { commit: commit.commitId, file: null } });
    setPicks((now) => now + 1);
  };

  const position = {
    index: currentRow === undefined ? null : currentIndex,
    count: rows.length,
    summary:
      currentRow === undefined
        ? ""
        : `${currentRow.commit.commitId.slice(0, 8)} ${currentRow.commit.description.split("\n")[0] ?? ""}`,
  };

  // With nothing picked the index is -1, so a step forward lands on the
  // first row.
  const step = (by: -1 | 1) => {
    const next = rows[currentIndex + by];
    if (next !== undefined) pick(next.commit.commitId);
  };

  const reviewOf = (row: StackRow): ComparisonReview => {
    const before = row.kind === "dropped" ? row.commit : row.was;
    const after = row.kind === "dropped" ? null : row.commit;
    const from = before?.commitId ?? null;
    const to = after?.commitId ?? null;
    const { reviewKey, keeps } = pullRowKey(review.document, from, to);
    return reviewComparison(review.document, reviewKey, from, to, keeps);
  };

  const links = (row: StackRow): DiffLinks => {
    const at = (file: FileSpot): PullPlace => ({
      ...place,
      to,
      spot: { commit: row.commit.commitId, file },
    });
    return {
      selected: row.key === currentKey ? (spot?.file ?? null) : null,
      href: (file) => pullHref(at(file)),
      onFollow: (file) => onGo(at(file)),
    };
  };

  return (
    <PullReviewPanes
      header={<PullHeader pull={pull} />}
      position={position}
      onStep={step}
      size={sizes["pull-commits"] ?? null}
      onResize={(size) => resize("pull-commits", size)}
      picker={
        <>
          <PullComparisonPicker
            history={history.data}
            from={from}
            to={to}
            files={pullFiles}
            onPickFrom={(next) => onGo({ ...place, from: next })}
            onPickTo={(head) => onGo({ ...place, to: head, spot: null })}
          />
          <LastReviewed
            states={history.data.states}
            reviewed={reviewed}
            from={from}
            to={to}
            toMarked={marked.some((mark) => mark.version === to)}
            onMark={
              review.status === "ready"
                ? () => {
                    review.actions.markReviewed(series, to);
                    onGo({ ...place, to });
                  }
                : null
            }
            onWhole={() => onGo({ ...openPull(number), to: latest.head })}
          />
        </>
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
            onSelect={pick}
          />
        ) : (
          <CommitLog
            source={{ kind: "pull", repo, number, head: to }}
            selected={current === null ? [] : [current]}
            onSelect={(selection) => pick(pickedFrom(selection, current))}
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
            reveal={picks + arrivals}
            links={links}
            reviewOf={reviewOf}
            actions={review.status === "ready" ? review.actions : null}
            display={display}
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

```ts
//| id: frontend-controller-pull-review-test
//| file: src/frontend/controllers/PullReview.test.ts
import { describe, expect, test } from "bun:test";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import { type GitCommit, GitOid } from "../model/history";
import type { Slot } from "../model/pairing";
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
        structural: { kind: "unavailable", reason: "not diffed" },
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
      structural: { kind: "unavailable", reason: "not diffed" },
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
        structural: { kind: "unavailable", reason: "not diffed" },
      },
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "@@ -1 +1 @@\n-a\n+b",
        structural: { kind: "unavailable", reason: "not diffed" },
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

Each row shows the base branch, since a pull request against a release
branch reads differently from one against `main`.

```tsx
//| id: frontend-view-pull-list
//| file: src/frontend/views/PullPanes/PullList.tsx
import type { PullSummary } from "../../model/pull";
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

The header links out to GitHub for the conversation, which diffy does not
show. On a phone the title wraps onto its own row.

```tsx
//| id: frontend-view-pull-header
//| file: src/frontend/views/PullPanes/PullReviewPanes/PullHeader.tsx
import type { PullSummary } from "../../../model/pull";
import { PullStateChip } from "../PullStateChip";

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

Two native `<select>`s, which a phone renders as a full-screen list. Only
"from" offers the base, since base as the after end reads the pull request
backwards, hence `from: PullBaseline` and `to: GitOid`. An option's value is
looked up in `history.states` rather than cast to a `GitOid`.
`truncated` adds a note that some versions are missing, since a collapsed
list gives no hint and GitHub does not say where the gap is.

The whole pull request's size sits beside "to", drawn by `ChangeCount`, as a
sibling of the `<label>` so it is not read as part of the field's name. It
shows nothing while loading or on failure; each row reports its own.

The caption names which comparison is on screen, a tree diff (base against a
head) or a diff of diffs (two heads), which the selects alone do not say.

```tsx
//| id: frontend-view-pull-comparison-picker
//| file: src/frontend/views/PullPanes/PullReviewPanes/PullComparisonPicker.tsx

import type { AsyncState } from "../../../model/asyncState";
import type { FileDiff } from "../../../model/diff";
import type { GitOid } from "../../../model/history";
import type {
  PullBaseline,
  PullHeadOrigin,
  PullHistory,
  PullVersion,
} from "../../../model/pull";
import { ChangeCount } from "../../CommitStack";

export function PullComparisonPicker({
  history,
  from,
  to,
  files,
  onPickFrom,
  onPickTo,
}: {
  history: PullHistory;
  from: PullBaseline;
  to: GitOid;
  /** Everything the `to` version changes against the base. */
  files: AsyncState<FileDiff[]>;
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
      {files.status === "ready" && (
        <span className="pull-compare__size">
          <span className="pull-compare__label">whole pull request</span>
          <ChangeCount files={files.data} />
        </span>
      )}
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

The selects wrap under each other on a phone and hold a 44px touch target.
`min-width: 0` keeps a long option from widening the row.

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

  .pull-compare__size {
    display: flex;
    gap: var(--space-3);
    color: var(--text-muted);
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

`PullStateChip` colours a state the same in the list and the header, from
`--state-open`, `--state-merged`, and `--state-closed`.

```tsx
//| id: frontend-view-pull-state-chip
//| file: src/frontend/views/PullPanes/PullStateChip.tsx
import type { PullState } from "../../model/pull";

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
