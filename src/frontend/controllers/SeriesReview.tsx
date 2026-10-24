// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-series-review>>[init]
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AsyncState } from "../model/asyncState";
import { compareAsks, withCompared } from "../model/compared";
import {
  componentsTo,
  DEFAULT_KINDS,
  seriesComponents,
} from "../model/components";
import type { FileDiff } from "../model/diff";
import { capturesOf } from "../model/evidence";
import type { GitCommit, Source } from "../model/history";
import { lastReviewed, opening } from "../model/lastReviewed";
import type { Slot } from "../model/pairing";
import type { PanelId } from "../model/panels";
import type { DiffLinks, FileSpot, SeriesPlace } from "../model/place";
import {
  type ComparisonReview,
  keptPairing,
  type ReviewDocument,
  reviewComparison,
  reviewedIn,
} from "../model/review";
import {
  type MarkLabel,
  rowAsk,
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
  capturesAt,
  followCapture,
  type Pick,
  stepCapture,
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
  /** What the whole of one version is called: `whole pull request`. */
  wholeLabel: string;
  markLabel: MarkLabel;
  /** The key a row comparing these two commits is filed under. */
  keyOf: (
    document: ReviewDocument,
    before: GitCommit | null,
    after: GitCommit | null,
  ) => { reviewKey: string; keeps: string | null };
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
  const [picks, setPicks] = useState(0);
  const panels = usePanelLayouts();
  const focus = useFocus();
  // The components panel's body, which the components view draws its rail
  // into from beside the code.
  const [railSlot, setRailSlot] = useState<HTMLElement | null>(null);
  // The capture the reader picked in the viewer, and how they compare it.
  const [picked, setPicked] = useState<Pick | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("side");
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
  const diffs = useRowDiffs(rowAsk(source, from, to), pairing.slots);

  const reviewOf = (row: StackRow): ComparisonReview => {
    const before = row.kind === "dropped" ? row.commit : row.was;
    const after = row.kind === "dropped" ? null : row.commit;
    const { reviewKey, keeps } = screen.keyOf(review.document, before, after);
    return reviewComparison(
      review.document,
      reviewKey,
      before?.commitId ?? null,
      after?.commitId ?? null,
      keeps,
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
    source,
    from: from.kind === "version" ? from.id : null,
    to,
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
  const goToThread = (thread: SeriesThread) => {
    onGo(threadPlace(thread, place, to));
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

  // The viewer shows the captures of the commit picked or being read.
  const atCommit = capturesAt(
    review.status === "ready"
      ? capturesOf(review.document.captures, series, to)
      : [],
    currentRow?.commit.commitId ?? focus.reading?.commit ?? null,
  );
  const readingComponent =
    focus.reading?.kind === "component" ? focus.reading.component : null;
  const captureShown = followCapture(atCommit, picked, readingComponent);
  const pickCapture = (id: string | null) =>
    setPicked(id === null ? null : { id, reading: readingComponent });
  const empty = new Set<PanelId>();
  if (!componentsOn) empty.add("components");
  if (captureShown === null) empty.add("viewer");

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
      badges={{
        ...(openThreads > 0 && { threads: `${openThreads} open` }),
        ...(atCommit.length > 0 && { viewer: `${atCommit.length}` }),
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
        viewer:
          captureShown === null ? (
            <Message>No captures of this commit.</Message>
          ) : (
            <Viewer
              captures={atCommit}
              shown={captureShown}
              mode={viewMode}
              components={
                new Map(
                  (toMap?.components ?? [])
                    .filter((each) => each.commitId === captureShown.commitId)
                    .map((each) => [each.id, each]),
                )
              }
              reading={readingComponent}
              onPick={pickCapture}
              onStep={(by) =>
                pickCapture(stepCapture(atCommit, captureShown.id, by))
              }
              onMode={setViewMode}
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
              onOpenRow={(key) =>
                setOpen((now) => (now.has(key) ? now : toggled(now, key)))
              }
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
// ~/~ end
