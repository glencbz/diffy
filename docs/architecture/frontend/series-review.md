# Series review

The screen that reads one series version by version, each end pinned to a
version the series has had. A [local review](local-reviews.md)'s
registrations are the versions.

## The version last reviewed

A second visit should start on what moved since the last. The review
document keeps every version the reader marked reviewed under
`local:<name>`, and a bare review address opens on the comparison from the
newest marked version the history still lists to the latest. Marking is
explicit: inferring it from what was on screen would treat a glance at the
title as a review and hide everything after it.

```ts
//| id: frontend-model-last-reviewed
//| file: src/frontend/model/lastReviewed.ts

import type { ReviewedVersion } from "../../model/review";
import type { SeriesPlace } from "./place";
import type { SeriesVersion } from "./series";

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
```

Only a bare address takes the remembered default; any version, commit, or file
in it wins. The since-review comparison is not written into the address,
which still means "this review at its default". A remembered version that is
the latest, or that the history no longer lists, opens the review whole, the
latter with a note.

```ts
//| id: frontend-model-last-reviewed
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
```

```ts
//| id: frontend-model-last-reviewed-test
//| file: src/frontend/model/lastReviewed.test.ts
import { describe, expect, test } from "bun:test";
import type { ReviewedVersion } from "../../model/review";
import { lastReviewed, opening } from "./lastReviewed";
import { type LocalPlace, openLocal } from "./place";
import type { SeriesVersion } from "./series";

function version(number: number, id: string): SeriesVersion {
  return { id, number, label: "" };
}

describe("opening", () => {
  const versions = [version(1, "a"), version(2, "b"), version(3, "c")];

  test("opens a bare address on the changes since the version last reviewed", () => {
    expect(opening(openLocal("stack"), "a", versions)).toEqual({
      name: "stack",
      from: { kind: "version", id: "a" },
      to: null,
      spot: null,
    });
  });

  test("opens whole when nothing was reviewed", () => {
    expect(opening(openLocal("stack"), null, versions)).toEqual(
      openLocal("stack"),
    );
  });

  test("opens whole when the latest version is the one reviewed", () => {
    expect(opening(openLocal("stack"), "c", versions)).toEqual(
      openLocal("stack"),
    );
  });

  test("opens whole when the version reviewed is no longer in the history", () => {
    expect(opening(openLocal("stack"), "f", versions)).toEqual(
      openLocal("stack"),
    );
  });

  test("leaves an address that names anything past the name alone", () => {
    const places: LocalPlace[] = [
      { ...openLocal("stack"), to: "c" },
      { ...openLocal("stack"), from: { kind: "version", id: "b" } },
      { ...openLocal("stack"), to: "c", spot: { commit: "d", file: null } },
    ];

    for (const place of places) {
      expect(opening(place, "a", versions)).toEqual(place);
    }
  });
});

describe("lastReviewed", () => {
  const versions = [version(1, "a"), version(2, "b"), version(3, "c")];

  function mark(id: string, reviewedAt: string): ReviewedVersion {
    return { series: "local:stack", version: id, reviewedAt };
  }

  test("takes the newest version marked, whenever it was marked", () => {
    // arrange
    const marked = [mark("b", "t1"), mark("a", "t2")];

    // act
    // assert
    expect(lastReviewed(marked, versions)).toBe("b");
  });

  test("takes the version marked last when the history lists none", () => {
    // arrange
    const marked = [mark("e", "t2"), mark("f", "t1")];

    // act
    // assert
    expect(lastReviewed(marked, versions)).toBe("e");
  });

  test("reads nothing reviewed when nothing is marked", () => {
    expect(lastReviewed([], versions)).toBeNull();
  });
});
```

`LastReviewed` names the version last reviewed when the comparison starts
there and ends on the latest, says when that version is gone, and holds the
button that marks the after end reviewed. A local review calls it **Submit review**,
since marking its newest version is what
[tells the agent](../backend/agents.md#telling-an-agent-the-reader-submitted)
the comments are ready. Marking pins the comparison into the
address, or the default would jump to the whole review as soon as the latest
version is marked.

```tsx
//| id: frontend-view-last-reviewed
//| file: src/frontend/views/LastReviewed.tsx
import {
  type MarkLabel,
  type SeriesBaseline,
  type SeriesVersion,
  type VersionMark,
  versionName,
} from "../model/series";

export function LastReviewed({
  versions,
  reviewed,
  from,
  to,
  mark,
  markLabel,
  wholeLabel,
  onWhole,
}: {
  versions: SeriesVersion[];
  reviewed: string | null;
  from: SeriesBaseline;
  to: string;
  /** The after version's mark. */
  mark: VersionMark;
  markLabel: MarkLabel;
  /** What reading the newest version whole is called: `whole review`. */
  wholeLabel: string;
  onWhole: () => void;
}) {
  const known = versions.find((version) => version.id === reviewed);
  const since =
    known !== undefined &&
    from.kind === "version" &&
    from.id === known.id &&
    to === versions.at(-1)?.id;

  return (
    <div className="last-reviewed">
      {since ? (
        <>
          <p className="last-reviewed__note">
            Showing what changed since v{known.number}, the version you last
            reviewed.
          </p>
          <button
            type="button"
            className="last-reviewed__action"
            onClick={onWhole}
          >
            Show {wholeLabel}
          </button>
        </>
      ) : reviewed !== null && known === undefined ? (
        <p className="last-reviewed__note">
          You last reviewed {reviewed.slice(0, 7)}, which this history no longer
          lists, so it opens whole.
        </p>
      ) : null}
      <MarkButton
        mark={mark}
        label={markLabel}
        name={versionName(versions, to)}
      />
    </div>
  );
}

function MarkButton({
  mark,
  label,
  name,
}: {
  mark: VersionMark;
  label: MarkLabel;
  name: string;
}) {
  switch (mark.kind) {
    case "marked":
      return (
        <button type="button" className="last-reviewed__action" disabled>
          {`${label.marked} ${name}`}
        </button>
      );
    case "unmarked":
      return (
        <button
          type="button"
          className="last-reviewed__action"
          onClick={mark.onMark}
        >
          {`${label.mark} ${name}`}
        </button>
      );
    case "unavailable":
      return null;
  }
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
    margin-left: auto;
  }

  .last-reviewed__note {
    flex: 1 1 auto;
    margin: 0;
  }

  .last-reviewed__action {
    padding: var(--space-2) var(--space-4);
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

@layer components-narrow {
  @media (max-width: 1000px) {
    .last-reviewed__action {
      min-height: 44px;
      padding: var(--space-3) var(--space-5);
    }
  }
}
```

## Row comparisons

`useRowDiffs` fetches each row's comparison keyed like `stackRows` keys its
rows, and caches by slot: moving a card changes what surrounds it, not what
it compares. The cache clears only when the workspace changes, since a commit
id names the same comparison in every version.

```tsx
//| id: frontend-state-row-diffs
//| file: src/frontend/state/rowDiffs.ts
import { useEffect, useRef, useState } from "react";
import type { AsyncState } from "../../model/asyncState";
import type { FileDiff } from "../../model/diff";
import { fetchLocalDiff } from "../api";
import type { Slot } from "../model/pairing";
import { useWorkspace } from "./repo";

/** The key a slot is addressed by. A fetched comparison and the row that
 *  shows it agree on this, so neither has to look the other up by anything
 *  else. */
export function slotKey(slot: Slot): string {
  return `${slot.left ?? ""}:${slot.right ?? ""}`;
}

/** One slot's comparison, or null for a slot with no commit in it. */
function slotDiff(workspace: string, slot: Slot): Promise<FileDiff[]> | null {
  if (slot.left === null && slot.right === null) return null;
  return fetchLocalDiff(workspace, slot.left, slot.right);
}

export type RowDiffs = Map<string, AsyncState<FileDiff[]>>;

const NO_DIFFS: RowDiffs = new Map();

/** The comparison behind each row, keyed the way a row is keyed. */
export function useRowDiffs(slots: Slot[]): RowDiffs {
  const workspace = useWorkspace();
  const [state, setState] = useState<{ workspace: string; cache: RowDiffs }>({
    workspace,
    cache: new Map(),
  });
  // Each key is asked once, so its answer must land even if a card moved
  // meanwhile; it is dropped only when the workspace changed.
  const asked = useRef<{ workspace: string; keys: Set<string> }>({
    workspace,
    keys: new Set(),
  });

  useEffect(() => {
    if (asked.current.workspace !== workspace)
      asked.current = { workspace, keys: new Set() };
    const { keys } = asked.current;

    for (const slot of slots) {
      const key = slotKey(slot);
      if (keys.has(key)) continue;
      const diff = slotDiff(workspace, slot);
      if (diff === null) continue;
      keys.add(key);

      const put = (value: AsyncState<FileDiff[]>) => {
        if (asked.current.workspace !== workspace) return;
        setState((now) => ({
          workspace,
          cache: new Map(now.workspace === workspace ? now.cache : []).set(
            key,
            value,
          ),
        }));
      };
      diff.then(
        (files) => put({ status: "ready", data: files }),
        (err: unknown) => put({ status: "error", message: String(err) }),
      );
    }
  }, [workspace, slots]);

  return state.workspace === workspace ? state.cache : NO_DIFFS;
}
```

## The comparison's size

The size beside the picker measures the comparison on screen. Against the
base it is one diff, [`useSeriesSize`](series.md#reading-a-series): all of the
version's commits together, what the review would land. Rows would miscount
it, since a line two commits rewrite counts in both.

Between two versions `rowsSize` totals the rows instead, the interdiff of each
pair, so the number matches the stack under it. The after version against its
base would answer "how big is the whole thing", not what changed since the
before end. A tree diff from one version to the other would count every
upstream commit a rebase brought in, and `jj interdiff` between the two tips
compares only the top commit of each.

## Series review controller

`SeriesReview` reads one series version by version, a
[local review](local-reviews.md)'s registrations, through a
[`SeriesScreen`](series.md), which holds what the series is: where versions
and commits come from, what the whole is called, how a row is filed, and
where a base comparison's single lane reads from. The before end defaults to the base and the
after end to the newest version, so a series opens on what it introduces.

The pairing flows one way: only `PairedGraph` can move a card, and
`stackRows` reads the pairing, so the diff pane draws whatever the graph
decided. A pick is a commit, not a row index, since a move renumbers rows. A
base comparison has nothing to pair, so it draws `CommitLog`'s single lane and
builds rows from the commit list; `usePairing` still runs, since hooks run on
every render, but its all-added answer goes unused.

Each row is reviewed under the key the screen's `keyOf` gives its two
commits, [`localRowKey`](review.md#review-state), so a hand-paired card carries its marks and comments. Only open rows hand their
files to [`useSources`](syntax.md#loading-each-side).

The ends, picked commit, file, and line come from the address as one
`SeriesPlace`; open rows and expanded messages are local state, except that
a linked file's row opens. Moving the before end keeps the picked commit,
moving the after end drops it. The stack scrolls on a graph pick or an
arrival from back/forward (`reveal`), never on a click in the diff. The
[stack stepper](layout.md#the-stack-stepper) steps by calling `pick`, so a
step is a pick in every respect. The place used is the one
[`opening`](#the-version-last-reviewed) resolves, so picks in a since-review
comparison keep its before end.

A version with a [component map](components.md#the-components-view) reads
with it laid over the same stack, unless the reader switched it off. The
layer stays mounted while a new comparison loads, since it holds the place
the reader is switching to, and the counterpart version's commits and
comparisons load only while it is on.

The drawer's [threads](threads.md) tab reads the same rows the stack draws,
so it says which threads this comparison leaves out. A jump to a thread is a
pick of its commit, file, and line, so it scrolls the stack the way a graph
pick does.

Scrolling the stack to another row writes that commit back to the address,
replacing the entry rather than pushing one, so back returns to the last
pick rather than every commit scrolled past. It goes through the address
rather than separate "row in view" state, because two answers to which
commit is current would disagree between a pick and the scroll it causes.

```tsx
//| id: frontend-controller-series-review
//| file: src/frontend/controllers/SeriesReview.tsx
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AsyncState } from "../../model/asyncState";
import {
  componentsTo,
  DEFAULT_KINDS,
  seriesComponents,
} from "../../model/components";
import type { FileDiff } from "../../model/diff";
import { capturesOf } from "../../model/evidence";
import type { GitCommit, Source } from "../../model/history";
import type { PanelId } from "../../model/panels";
import {
  type ComparisonReview,
  keptPairing,
  type ReviewDocument,
  type RowComment,
  reviewComparison,
  reviewedIn,
  type ThreadReview,
  threadReview,
} from "../../model/review";
import { runsOf } from "../../model/runs";
import { compareAsks, withCompared } from "../model/compared";
import { lastReviewed, opening } from "../model/lastReviewed";
import type { Slot } from "../model/pairing";
import type { DiffLinks, FileSpot, SeriesPlace } from "../model/place";
import { ranRules } from "../model/ranLines";
import {
  compareLogged,
  compareRequests,
  partAnchor,
  partNotes,
  stepAsCapture,
  stepsAt,
} from "../model/runSteps";
import {
  type MarkLabel,
  type SeriesHistory,
  type SeriesSource,
  versionAsk,
  versionName,
} from "../model/series";
import {
  drawnThreads,
  type SeriesThread,
  seriesThreads,
  threadPlace,
} from "../model/threads";
import {
  followItem,
  type Item,
  itemKey,
  notesOn,
  type Pick,
  type Subject,
  stepItem,
  type ViewMode,
} from "../model/viewer";
import { useBeforePaths, useCompared } from "../state/compared";
import { useCounterpart, useOwnDiffs } from "../state/components";
import { useFocus } from "../state/focus";
import { usePairing } from "../state/pairing";
import { usePanelLayouts } from "../state/panels";
import { useArrivals, type Visit } from "../state/place";
import type { ReviewHandle } from "../state/review";
import { type RowDiffs, slotKey, useRowDiffs } from "../state/rowDiffs";
import {
  useEveryVersion,
  useSeriesCommits,
  useSeriesSize,
} from "../state/series";
import { useSettingsContext } from "../state/settings";
import { useSources } from "../state/source";
import {
  type ChangeSize,
  CommitStack,
  changeSize,
  countLines,
  type StackLayer,
  type StackRow,
  type StackRowKind,
} from "../views/CommitStack";
import { ComponentsStack } from "../views/Components/ComponentsStack";
import { ComponentsSwitch } from "../views/ComponentsSwitch";
import { LastReviewed } from "../views/LastReviewed";
import { Message } from "../views/Message";
import { PairedGraph } from "../views/PairedGraph";
import { PullReviewPanes } from "../views/PullReviewPanes/PullReviewPanes";
import { Console } from "../views/Runs/Console";
import { Network } from "../views/Runs/Network";
import { SeriesComparisonPicker } from "../views/SeriesComparisonPicker";
import { ThreadList } from "../views/ThreadList";
import { Viewer } from "../views/Viewer/Viewer";
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

function isMessage(file: FileDiff): boolean {
  return "path" in file && file.path === DESCRIPTION_FILE;
}

function pairedKind(files: AsyncState<FileDiff[]>): StackRowKind {
  // Nothing is known about a pair until its comparison lands, and a
  // comparison that failed says nothing either.
  if (files.status !== "ready") return "plain";
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

/** What the rows of a two-version comparison add up to, waiting on every
 *  row. A file counts once however many rows touch it, a changed message is
 *  no file, and a dropped commit's lines count as removed, since its row
 *  shows what it used to add. */
export function rowsSize(rows: StackRow[]): AsyncState<ChangeSize> {
  const paths = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.files.status !== "ready") return row.files;
    const files = row.files.data.filter((file) => !isMessage(file));
    for (const file of files) {
      paths.add("path" in file ? file.path : file.newPath);
    }
    const lines = countLines(files);
    const dropped = row.kind === "dropped";
    added += dropped ? lines.removed : lines.added;
    removed += dropped ? lines.added : lines.removed;
  }
  return { status: "ready", data: { files: paths.size, added, removed } };
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

/** What differs between one kind of series and another, which is where its
 *  versions and commits come from and how its rows are filed. */
export interface SeriesScreen {
  source: SeriesSource;
  /** The series its versions are marked reviewed under. */
  series: string;
  /** Every version, at least one, oldest first. */
  history: SeriesHistory;
  header: ReactNode;
  /** What the whole of one version is called: `whole review`. */
  wholeLabel: string;
  markLabel: MarkLabel;
  /** The key a row comparing these two commits is filed under. */
  keyOf: (
    document: ReviewDocument,
    before: GitCommit | null,
    after: GitCommit | null,
  ) => { reviewKey: string };
  /** Where the single lane of a base comparison reads one version from. */
  lane: (id: string) => Source;
}

export function SeriesReview({
  screen,
  place: asked,
  review,
  onGo,
  href,
}: {
  screen: SeriesScreen;
  place: SeriesPlace;
  review: ReviewHandle;
  onGo: (place: SeriesPlace, visit?: Visit) => void;
  href: (place: SeriesPlace) => string;
}) {
  const { source, series, history } = screen;
  const { versions } = history;
  const {
    settings: { display },
    setComponents,
  } = useSettingsContext();
  const marked = reviewedIn(review.document, series);
  const reviewed = lastReviewed(marked, versions);
  const place = opening(asked, reviewed, versions);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [picks, setPicks] = useState(0);
  const panels = usePanelLayouts();
  const focus = useFocus();
  // The components panel's body, which the components view draws its rail
  // into from beside the code.
  const [railSlot, setRailSlot] = useState<HTMLElement | null>(null);
  // The capture or run the reader picked in the viewer, how they compare it,
  // and the step of a run in focus, which a new run starts at its first.
  const [picked, setPicked] = useState<Pick | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("side");
  const [stepAt, setStepAt] = useState<{ run: string; index: number } | null>(
    null,
  );
  const arrivals = useArrivals();
  const { from, spot } = place;
  const current = spot?.commit ?? null;

  const newest = versions.at(-1)?.id ?? "";
  const beforeId = from.kind === "version" ? from.id : null;
  const to = place.to ?? newest;

  const beforeState = useSeriesCommits(
    beforeId === null ? null : versionAsk(source, beforeId),
  );
  const afterState = useSeriesCommits(versionAsk(source, to));
  const beforeCommits =
    beforeState.status === "ready" ? beforeState.data : NO_COMMITS;
  const afterCommits =
    afterState.status === "ready" ? afterState.data : NO_COMMITS;

  const wholeSize = useSeriesSize(
    from.kind === "base" ? versionAsk(source, to) : null,
  );
  const pairingHeads =
    beforeId === null ? null : { series, before: beforeId, after: to };
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
  const diffs = useRowDiffs(pairing.slots);

  const reviewOf = (row: StackRow): ComparisonReview => {
    const before = row.kind === "dropped" ? row.commit : row.was;
    const after = row.kind === "dropped" ? null : row.commit;
    const { reviewKey } = screen.keyOf(review.document, before, after);
    return reviewComparison(
      review.document,
      reviewKey,
      before?.commitId ?? null,
      after?.commitId ?? null,
    );
  };

  const stacked =
    from.kind === "base"
      ? baseStackRows(afterCommits, diffs)
      : stackRows(pairing.slots, beforeCommits, afterCommits, diffs);
  const compared = useCompared(
    stacked.flatMap((row) => compareAsks(reviewOf(row))),
  );
  const beforePaths = useBeforePaths();
  // A version an agent wrote a component map of reads with it laid over the
  // stack, unless the reader took it off.
  const maps = review.status === "ready" ? review.document.componentMaps : [];
  const toMap = componentsTo(maps, series, to);
  const componentsOn = toMap !== undefined && display.components === "shown";
  // Every version's components and groups, the ones on screen first. Held
  // across renders, since the view keys its layer on them.
  const fromId = from.kind === "version" ? from.id : null;
  const { components, groups } = useMemo(
    () => seriesComponents(maps, series, fromId === null ? [to] : [to, fromId]),
    [maps, series, to, fromId],
  );
  const counterparts = useCounterpart({
    source,
    series,
    versions,
    to,
    commits: afterCommits,
    maps,
    enabled: componentsOn && from.kind === "base",
  });
  const [ownDiffs, wantOwn] = useOwnDiffs({
    fromCommits: beforeCommits,
    toCommits: afterCommits,
  });

  const rows = stacked.map((row): StackRow => {
    if (row.files.status !== "ready") return row;
    const files = withCompared(
      row.files.data,
      compareAsks(reviewOf(row)),
      compared,
    );
    return { ...row, files: { status: "ready", data: files } };
  });
  // A peek can show a version's file no open row draws, so its sides load
  // with the rest.
  const [peekFiles, setPeekFiles] = useState<FileDiff[]>([]);
  const peekAt = useCallback(
    (files: FileDiff[]) =>
      setPeekFiles((now) => (sameFiles(now, files) ? now : files)),
    [],
  );
  const sources = useSources([
    ...rows.flatMap((row) =>
      open.has(row.key) && row.files.status === "ready" ? row.files.data : [],
    ),
    ...peekFiles,
  ]);

  const everyVersion = useEveryVersion(source, versions);
  const threads =
    everyVersion.status === "ready"
      ? seriesThreads(
          review.document.comments,
          everyVersion.data,
          drawnThreads(
            rows.map((row) => ({
              key: row.key,
              commitId: row.commit.commitId,
              files: row.files.status === "ready" ? row.files.data : null,
              comments: reviewOf(row).comments,
            })),
          ),
        )
      : [];
  const [raise, setRaise] = useState<{ panel: PanelId; at: number } | null>(
    null,
  );
  const goToThread = (thread: SeriesThread) => {
    onGo(threadPlace(thread, place, to));
    // A thread on a capture or a run is read where it is drawn, so the
    // viewer or the Network panel picks it and comes to the front.
    const { comment } = thread;
    if (comment.kind === "capture" || comment.kind === "step") {
      const key =
        comment.kind === "capture"
          ? `capture:${comment.capture}`
          : `run:${comment.run}`;
      setPicked({ id: key, reading: readingComponent });
      if (comment.kind === "step") {
        setStepAt({ run: comment.run, index: comment.step });
      }
      setRaise((now) => ({
        panel:
          comment.kind !== "step"
            ? "viewer"
            : comment.request !== null
              ? "network"
              : comment.console !== null
                ? "console"
                : "viewer",
        at: (now?.at ?? 0) + 1,
      }));
    }
    // A thread on the whole commit picks no file, so nothing else opens a
    // quiet row to show it.
    const row = thread.drawn?.row;
    if (row !== undefined) {
      setOpen((now) => (now.has(row) ? now : new Set(now).add(row)));
    }
    setPicks((now) => now + 1);
  };

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

  const commitsLoading =
    beforeState.status === "loading" || afterState.status === "loading";
  const commitsError =
    beforeState.status === "error"
      ? beforeState.message
      : afterState.status === "error"
        ? afterState.message
        : null;

  const size: AsyncState<ChangeSize> =
    from.kind === "base"
      ? wholeSize.status === "ready"
        ? { status: "ready", data: changeSize(wholeSize.data) }
        : wholeSize
      : commitsLoading || commitsError !== null
        ? { status: "loading" }
        : rowsSize(rows);

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

  const links = (row: StackRow): DiffLinks => {
    const at = (file: FileSpot): SeriesPlace => ({
      ...place,
      to,
      spot: { commit: row.commit.commitId, file },
    });
    return {
      selected: row.key === currentKey ? (spot?.file ?? null) : null,
      href: (file) => href(at(file)),
      onFollow: (file) => onGo(at(file)),
    };
  };

  const stack = (layer?: StackLayer) => (
    <CommitStack
      rows={rows}
      sources={sources}
      open={open}
      onToggle={(key) => setOpen((now) => toggled(now, key))}
      expanded={expanded}
      onExpand={(key) => setExpanded((now) => toggled(now, key))}
      folded={folded}
      onFold={(key) => setFolded((now) => toggled(now, key))}
      current={currentKey}
      onInView={(key) => {
        const row = rows.find((candidate) => candidate.key === key);
        if (row === undefined) return;
        onGo(
          {
            ...place,
            to,
            spot: { commit: row.commit.commitId, file: null },
          },
          "replace",
        );
      }}
      reveal={picks + arrivals}
      links={links}
      reviewOf={reviewOf}
      actions={review.status === "ready" ? review.actions : null}
      beforePaths={beforePaths}
      display={display}
      since={
        from.kind === "version" ? versionName(versions, from.id) : "the base"
      }
      layer={layer}
    />
  );

  const label = (id: string) =>
    `${versionName(versions, id)} · ${id.slice(0, 7)}`;
  const openThreads = threads.filter(
    (thread) => !thread.comment.resolved,
  ).length;

  // The viewer holds every capture and run of the version and starts on
  // those of the commit picked or being read; Network and Console show the
  // step in focus of the run shown.
  const inView = currentRow?.commit.commitId ?? focus.reading?.commit ?? null;
  const versionCaptures =
    review.status === "ready"
      ? capturesOf(review.document.captures, series, to)
      : [];
  const versionRuns =
    review.status === "ready" ? runsOf(review.document.runs, series, to) : [];
  const items: Item[] = [
    ...versionCaptures.map((capture): Item => ({ kind: "capture", capture })),
    ...versionRuns.map((run): Item => ({ kind: "run", run })),
  ];
  const readingComponent =
    focus.reading?.kind === "component" ? focus.reading.component : null;
  const itemShown = followItem(
    versionCaptures,
    versionRuns,
    picked,
    readingComponent,
    inView,
  );
  const runShown = itemShown?.kind === "run" ? itemShown.run : null;
  const stepIndex =
    runShown !== null && stepAt?.run === runShown.id
      ? Math.min(stepAt.index, runShown.after.steps.length - 1)
      : 0;
  const stepShown = runShown === null ? null : stepsAt(runShown, stepIndex);
  const captureShown =
    itemShown === null
      ? null
      : itemShown.kind === "capture"
        ? itemShown.capture
        : stepAsCapture(itemShown.run, stepIndex);
  // A capture or run is about its commit, so its threads are filed with
  // that commit's row and drawn where the row's are.
  const threadsOf = (
    commitId: string,
    which: (comments: RowComment[]) => RowComment[],
  ): ThreadReview | null => {
    const row = rows.find((each) => each.commit.commitId === commitId);
    if (row === undefined || review.status !== "ready") return null;
    const kept = reviewOf(row);
    return threadReview(review.actions, kept, which(kept.comments));
  };
  const subject: Subject | null =
    itemShown === null
      ? null
      : itemShown.kind === "capture"
        ? { kind: "capture", capture: itemShown.capture.id }
        : { kind: "step", run: itemShown.run.id, step: stepIndex };
  const viewerThreads =
    subject === null || captureShown === null
      ? null
      : threadsOf(captureShown.commitId, (comments) =>
          notesOn(comments, subject),
        );
  const partThreads =
    runShown === null
      ? null
      : threadsOf(runShown.commitId, (comments) =>
          partNotes(comments, runShown.id, stepIndex),
        );
  const pickItem = (key: string | null) =>
    setPicked(key === null ? null : { id: key, reading: readingComponent });
  const empty = new Set<PanelId>();
  if (!componentsOn) empty.add("components");
  if (captureShown === null) empty.add("viewer");
  if (stepShown === null) {
    empty.add("network");
    empty.add("console");
  }

  return (
    <PullReviewPanes
      header={screen.header}
      position={position}
      onStep={step}
      tree={panels.tree}
      layouts={panels.layouts}
      layout={panels.layout.id}
      onChoose={panels.choose}
      onArrange={panels.arrange}
      onUndo={panels.undo}
      onReset={panels.reset}
      empty={empty}
      raise={raise}
      badges={{
        ...(openThreads > 0 && { threads: `${openThreads} open` }),
        ...(items.length > 0 && { viewer: `${items.length}` }),
      }}
      tools={{
        code: (
          <ComponentsSwitch
            shown={display.components}
            disabled={toMap === undefined}
            onChange={setComponents}
          />
        ),
      }}
      picker={
        <>
          <SeriesComparisonPicker
            history={history}
            from={from}
            to={to}
            size={size}
            wholeLabel={screen.wholeLabel}
            onPickFrom={(next) => onGo({ ...place, from: next })}
            onPickTo={(id) => onGo({ ...place, to: id, spot: null })}
          />
          <LastReviewed
            versions={versions}
            reviewed={reviewed}
            from={from}
            to={to}
            mark={
              marked.some((mark) => mark.version === to)
                ? { kind: "marked" }
                : review.status === "ready"
                  ? {
                      kind: "unmarked",
                      onMark: () => {
                        review.actions.markReviewed(series, to);
                        onGo({ ...place, to });
                      },
                    }
                  : { kind: "unavailable" }
            }
            markLabel={screen.markLabel}
            wholeLabel={`the ${screen.wholeLabel}`}
            onWhole={() =>
              onGo({ from: { kind: "base" }, to: newest, spot: null })
            }
          />
        </>
      }
      bodies={{
        threads:
          everyVersion.status === "error" ? (
            <Message tone="error">{everyVersion.message}</Message>
          ) : everyVersion.status === "loading" ? (
            <Message>Loading threads...</Message>
          ) : (
            <ThreadList
              threads={threads}
              actions={review.status === "ready" ? review.actions : null}
              onGo={goToThread}
            />
          ),
        commits:
          commitsError !== null ? (
            <Message tone="error">{commitsError}</Message>
          ) : commitsLoading ? (
            <Message>Loading commits...</Message>
          ) : from.kind === "version" ? (
            <PairedGraph
              before={beforeCommits}
              after={afterCommits}
              pairing={pairing}
              beforeLabel={label(from.id)}
              afterLabel={label(to)}
              current={current}
              onSelect={pick}
            />
          ) : (
            <CommitLog
              source={screen.lane(to)}
              selected={current === null ? [] : [current]}
              onSelect={(selection) => pick(pickedFrom(selection, current))}
              oldestFirst
            />
          ),
        components: <div className="components-slot" ref={setRailSlot} />,
        network:
          runShown === null || stepShown === null ? (
            <Message>No run of this commit.</Message>
          ) : (
            <Network
              label={stepShown.after?.label ?? ""}
              requests={compareRequests(
                runShown.before === null
                  ? null
                  : (stepShown.before?.requests ?? []),
                stepShown.after?.requests ?? [],
              )}
              notes={
                partThreads === null
                  ? null
                  : {
                      review: partThreads,
                      anchorOf: (request) =>
                        partAnchor(runShown.id, stepIndex, {
                          request: { method: request.method, url: request.url },
                          console: null,
                        }),
                    }
              }
            />
          ),
        console:
          runShown === null || stepShown === null ? (
            <Message>No run of this commit.</Message>
          ) : (
            <Console
              label={stepShown.after?.label ?? ""}
              lines={compareLogged(
                runShown.before === null
                  ? null
                  : (stepShown.before?.console ?? []),
                stepShown.after?.console ?? [],
              )}
              notes={
                partThreads === null
                  ? null
                  : {
                      review: partThreads,
                      anchorOf: (line) =>
                        partAnchor(runShown.id, stepIndex, {
                          request: null,
                          console: { level: line.level, text: line.text },
                        }),
                    }
              }
            />
          ),
        viewer:
          captureShown === null || itemShown === null ? (
            <Message>No captures of this version.</Message>
          ) : (
            <Viewer
              items={items}
              inView={inView}
              shownKey={itemKey(itemShown)}
              shown={captureShown}
              steps={
                runShown === null
                  ? null
                  : {
                      labels: runShown.after.steps.map((each) => each.label),
                      at: stepIndex,
                      stopped: runShown.before?.stopped ?? null,
                      ran: (stepShown?.after?.ran ?? []).map(
                        (each) => each.path,
                      ),
                      onAt: (index) => setStepAt({ run: runShown.id, index }),
                    }
              }
              mode={viewMode}
              components={
                new Map(
                  (toMap?.components ?? [])
                    .filter((each) => each.commitId === captureShown.commitId)
                    .map((each) => [each.id, each]),
                )
              }
              reading={readingComponent}
              onPick={pickItem}
              onStep={(by) => pickItem(stepItem(items, itemKey(itemShown), by))}
              onMode={setViewMode}
              notes={
                subject === null || viewerThreads === null
                  ? null
                  : { subject, review: viewerThreads }
              }
              onGo={(component) =>
                focus.ask({
                  kind: "component",
                  commit: captureShown.commitId,
                  component,
                  path: null,
                })
              }
            />
          ),
        code: (
          // The stack always sits inside the components view, on or off, so
          // switching the map keeps every file's state, and a switch to another
          // comparison keeps the place the reader is going to while it loads.
          <div className="code-panel">
            {runShown !== null && stepShown?.after != null && (
              <style>
                {ranRules(
                  runShown.commitId,
                  stepShown.after.ran,
                  stepShown.before?.ran ?? null,
                )}
              </style>
            )}
            <ComponentsStack
              enabled={componentsOn}
              rows={rows}
              components={components}
              groups={groups}
              kinds={
                review.status === "ready"
                  ? review.document.componentKinds
                  : DEFAULT_KINDS
              }
              sources={sources}
              onPeekFiles={peekAt}
              current={currentKey}
              open={open}
              onOpenRow={(key) => {
                setOpen((now) => (now.has(key) ? now : toggled(now, key)));
                // Going to a component unfolds its commit, or it would
                // land on a spine.
                setFolded((now) => (now.has(key) ? toggled(now, key) : now));
              }}
              onExpandMessage={(key) =>
                setExpanded((now) => (now.has(key) ? now : toggled(now, key)))
              }
              from={
                from.kind === "version"
                  ? { id: from.id, name: versionName(versions, from.id) }
                  : null
              }
              to={{ id: to, name: versionName(versions, to) }}
              counterparts={counterparts}
              ownDiffs={ownDiffs}
              onWantOwn={wantOwn}
              onCompare={(nextFrom, nextTo, commit) =>
                onGo({
                  ...place,
                  from:
                    nextFrom === null
                      ? { kind: "base" }
                      : { kind: "version", id: nextFrom },
                  to: nextTo,
                  spot: commit === null ? null : { commit, file: null },
                })
              }
              comments={
                review.status === "ready" ? review.document.comments : []
              }
              reviewOf={reviewOf}
              onTogglePlaceSeen={
                review.status === "ready"
                  ? review.actions.togglePlaceSeen
                  : null
              }
              split={display.diffLayout === "split"}
              railSlot={railSlot}
              reading={focus.reading}
              onRead={focus.onRead}
              asked={focus.asked}
            >
              {(layer) =>
                commitsError !== null ? (
                  <Message tone="error">{commitsError}</Message>
                ) : commitsLoading ? (
                  <Message>Loading commits...</Message>
                ) : (
                  stack(layer)
                )
              }
            </ComponentsStack>
          </div>
        ),
      }}
    />
  );
}

/** Whether two lists name the same files at the same blobs. */
function sameFiles(a: FileDiff[], b: FileDiff[]): boolean {
  const key = (files: FileDiff[]) =>
    files.map((file) => `${file.oldBlob}:${file.newBlob}`).join(" ");
  return key(a) === key(b);
}
```

## Series comparison picker

Two native `<select>`s, which a phone renders as a full-screen list. Only
"from" offers the base, since base as the after end reads the series
backwards, hence `from: SeriesBaseline` and `to` as a version id. An
option's value is looked up in `history.versions` rather than trusted, and
labelled by its [number and label](series.md#describing-a-series).

The comparison's [size](#the-comparisons-size) sits beside "to", drawn by
`ChangeCount`, as a sibling of the `<label>` so it is not read as part of the
field's name. It shows nothing while loading or on failure; each row reports
its own.

The caption names which comparison is on screen, a tree diff (base against a
version) or a diff of diffs (two versions), which the selects alone do not
say.

```tsx
//| id: frontend-view-series-comparison-picker
//| file: src/frontend/views/SeriesComparisonPicker.tsx
import type { AsyncState } from "../../model/asyncState";
import {
  type SeriesBaseline,
  type SeriesHistory,
  type SeriesVersion,
  versionName,
} from "../model/series";
import { ChangeCount, type ChangeSize } from "./CommitStack";

export function SeriesComparisonPicker({
  history,
  from,
  to,
  size,
  wholeLabel,
  onPickFrom,
  onPickTo,
}: {
  history: SeriesHistory;
  from: SeriesBaseline;
  to: string;
  /** The size of the comparison on screen, whichever ends it has. */
  size: AsyncState<ChangeSize>;
  /** What the whole of one version is called: `whole review`. */
  wholeLabel: string;
  onPickFrom: (from: SeriesBaseline) => void;
  onPickTo: (id: string) => void;
}) {
  const { versions, baseLabel } = history;

  return (
    <div className="pull-compare">
      <label className="pull-compare__field">
        <span className="pull-compare__label">from</span>
        <select
          value={from.kind === "base" ? "base" : from.id}
          onChange={(event) =>
            onPickFrom(parseBaseline(event.target.value, versions))
          }
          className="pull-compare__select"
        >
          <option value="base">{`base (${baseLabel})`}</option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {versionLabel(version)}
            </option>
          ))}
        </select>
      </label>
      <label className="pull-compare__field">
        <span className="pull-compare__label">to</span>
        <select
          value={to}
          onChange={(event) => onPickTo(lookup(event.target.value, versions))}
          className="pull-compare__select"
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {versionLabel(version)}
            </option>
          ))}
        </select>
      </label>
      {size.status === "ready" && (
        <span className="pull-compare__size">
          <span className="pull-compare__label">{wholeLabel}</span>
          <ChangeCount size={size.data} />
        </span>
      )}
      <p className="pull-compare__caption">{caption(history, from, to)}</p>
    </div>
  );
}

function parseBaseline(
  value: string,
  versions: SeriesVersion[],
): SeriesBaseline {
  if (value === "base") return { kind: "base" };
  return { kind: "version", id: lookup(value, versions) };
}

function lookup(value: string, versions: SeriesVersion[]): string {
  const version = versions.find((candidate) => candidate.id === value);
  if (version === undefined) {
    throw new Error(`no version of this series is ${value}`);
  }
  return version.id;
}

function versionLabel(version: SeriesVersion): string {
  return `v${version.number} (${version.label})`;
}

function caption(
  { versions, base }: SeriesHistory,
  from: SeriesBaseline,
  to: string,
): string {
  if (from.kind === "base") {
    return `what ${versionName(versions, to)} adds to ${base}`;
  }
  if (from.id === to) {
    return `${versionName(versions, to)} against itself`;
  }
  return `what changed between ${versionName(versions, from.id)} and ${versionName(versions, to)}`;
}
```

The selects wrap under each other on a phone and hold a 44px touch target
there; on a wide screen it would only make the toolbar taller than its text.
`min-width: 0` keeps a long option from widening the row. The caption naming
the kind of comparison follows the size on the same line rather than taking
a band of its own.

```css
/*| id: design-pull-comparison-picker
@layer components {
  .pull-compare {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    min-width: 0;
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
    min-width: 0;
    font: inherit;
  }

  .pull-compare__size {
    display: flex;
    gap: var(--space-3);
    color: var(--text-muted);
  }

  .pull-compare__caption {
    margin: 0;
    color: var(--text-faint);
  }
}

@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-compare__select {
      min-height: 44px;
    }
  }
}
```
