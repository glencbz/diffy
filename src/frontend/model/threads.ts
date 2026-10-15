// ~/~ begin <<docs/architecture/frontend/threads.md#frontend-model-threads>>[init]
import { shownPathOf } from "./changedFiles";
import type { FileDiff } from "./diff";
import type { GitCommit } from "./history";
import type { FileSpot, SeriesPlace } from "./place";
import { type Comment, drawnAt, type RowComment } from "./review";
import type { SeriesVersion } from "./series";

/** One version of a series and its commits, oldest first. */
export interface VersionCommits {
  version: SeriesVersion;
  commits: GitCommit[];
}

/** A row of the comparison on screen, as far as its threads go. */
export interface ShownRow {
  key: string;
  commitId: string;
  /** Null while the row's comparison loads. */
  files: FileDiff[] | null;
  /** Its comments as the row reads them. */
  comments: RowComment[];
}

/** Where the comparison on screen draws a thread. */
export interface Drawn {
  row: string;
  commitId: string;
  comment: RowComment;
  /** The patch of the file a line comment is on, to find its line in. */
  patch: string;
}

export interface SeriesThread {
  comment: Comment;
  /** The oldest version that has the commit it was written on. */
  written: SeriesVersion;
  commit: GitCommit;
  /** Null where the comparison on screen does not draw it. */
  drawn: Drawn | null;
  /** Whether the newest version has lost its change. */
  dropped: boolean;
}

export function drawnThreads(rows: ShownRow[]): Map<string, Drawn> {
  const drawn = new Map<string, Drawn>();
  for (const row of rows) {
    if (row.files === null) continue;
    const patches = new Map(
      row.files.map((file) => [shownPathOf(file), file.patch]),
    );
    for (const comment of row.comments) {
      const patch =
        comment.kind === "comparison" ? "" : patches.get(comment.path);
      if (patch === undefined) continue;
      drawn.set(comment.id, {
        row: row.key,
        commitId: row.commitId,
        comment,
        patch,
      });
    }
  }
  return drawn;
}

/** Every thread on the series, newest version first, then in commit order,
 *  then oldest first. */
export function seriesThreads(
  comments: Comment[],
  versions: VersionCommits[],
  drawn: Map<string, Drawn>,
): SeriesThread[] {
  const newest = new Set(
    versions.at(-1)?.commits.map((commit) => commit.changeId) ?? [],
  );
  const found: { thread: SeriesThread; index: number }[] = [];
  for (const comment of comments) {
    const at = writtenAt(versions, comment.commitId);
    if (at === null) continue;
    found.push({
      thread: {
        comment,
        written: at.version,
        commit: at.commit,
        drawn: drawn.get(comment.id) ?? null,
        dropped: at.commit.changeId !== null && !newest.has(at.commit.changeId),
      },
      index: at.index,
    });
  }
  return found
    .sort(
      (a, b) =>
        b.thread.written.number - a.thread.written.number ||
        a.index - b.index ||
        a.thread.comment.createdAt.localeCompare(b.thread.comment.createdAt),
    )
    .map(({ thread }) => thread);
}

function writtenAt(
  versions: VersionCommits[],
  commitId: string,
): { version: SeriesVersion; commit: GitCommit; index: number } | null {
  for (const { version, commits } of versions) {
    const index = commits.findIndex((commit) => commit.commitId === commitId);
    const commit = commits[index];
    if (commit !== undefined) return { version, commit, index };
  }
  return null;
}

export type ThreadFilter = "open" | "resolved" | "all";

export function threadsIn(
  threads: SeriesThread[],
  filter: ThreadFilter,
): SeriesThread[] {
  if (filter === "all") return threads;
  const resolved = filter === "resolved";
  return threads.filter((thread) => thread.comment.resolved === resolved);
}

/** Runs of threads written on the same version, in the order given. */
export function byVersion(
  threads: SeriesThread[],
): { version: SeriesVersion; threads: SeriesThread[] }[] {
  const runs: { version: SeriesVersion; threads: SeriesThread[] }[] = [];
  for (const thread of threads) {
    const last = runs.at(-1);
    if (last?.version.id === thread.written.id) last.threads.push(thread);
    else runs.push({ version: thread.written, threads: [thread] });
  }
  return runs;
}

/** Where a jump to a thread lands. `to` is the version the place shows. */
export function threadPlace(
  thread: SeriesThread,
  place: SeriesPlace,
  to: string,
): SeriesPlace {
  const { comment, drawn } = thread;
  const file: FileSpot | null =
    comment.kind === "comparison"
      ? null
      : { path: comment.path, line: afterLine(thread) };
  if (drawn !== null) {
    return { ...place, to, spot: { commit: drawn.commitId, file } };
  }
  return {
    from: { kind: "base" },
    to: thread.written.id,
    spot: { commit: comment.commitId, file },
  };
}

/** The after-side line a jump picks. A line drawn only on the before side has
 *  no number the address can hold, so the jump picks its file. */
function afterLine({ comment, drawn }: SeriesThread): number | null {
  if (comment.kind !== "line") return null;
  const at = drawn === null ? comment : drawnAt(drawn.comment, drawn.patch);
  return at?.side === "after" ? at.line : null;
}
// ~/~ end
