// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-review>>[init]
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
  const [picks, setPicks] = useState(0);

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

  const pick = (commitId: string) => {
    setCurrent(commitId);
    setPicks((now) => now + 1);
  };

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
            picks={picks}
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
// ~/~ end
