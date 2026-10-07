// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-model-compared>>[init]
import type { AsyncState } from "./asyncState";
import { afterPathOf } from "./changedFiles";
import type { FileDiff } from "./diff";
import type { CompareOffer, ComparisonReview, ReviewActions } from "./review";

/** One file of a row read against another, as the server is asked for it:
 *  `oldPath` on the before side, `newPath` on the after side. */
export interface CompareAsk {
  fromCommit: string | null;
  toCommit: string;
  oldPath: string;
  newPath: string;
}

export function compareKey(ask: CompareAsk): string {
  return JSON.stringify([
    ask.fromCommit,
    ask.toCommit,
    ask.oldPath,
    ask.newPath,
  ]);
}

/** A compared diff, or null while nobody has asked for it. */
export type ComparedLookup = (ask: CompareAsk) => AsyncState<FileDiff> | null;

/** Every path a row's before side holds, asked for when the reader first
 *  looks for one. */
export interface BeforePaths {
  get: (
    fromCommit: string | null,
    toCommit: string,
  ) => AsyncState<string[]> | null;
  want: (fromCommit: string | null, toCommit: string) => void;
}

/** What a row's compared files ask the server. A row with no after side
 *  has nothing to compare. */
export function compareAsks(row: ComparisonReview): CompareAsk[] {
  const { fromCommitId, toCommitId } = row;
  if (toCommitId === null) return [];
  return row.compared.map(({ oldPath, newPath }) => ({
    fromCommit: fromCommitId,
    toCommit: toCommitId,
    oldPath,
    newPath,
  }));
}

/** What a row offers its files to compare with. A row with no after side
 *  has nothing to compare. */
export function compareOffer(
  row: ComparisonReview,
  beforePaths: BeforePaths,
  compare: ReviewActions["compare"],
): CompareOffer | null {
  const { fromCommitId, toCommitId } = row;
  if (toCommitId === null) return null;
  return {
    compared: row.compared,
    beforePaths: beforePaths.get(fromCommitId, toCommitId),
    onWantBeforePaths: () => beforePaths.want(fromCommitId, toCommitId),
    onCompare: (newPath, oldPath) => compare(row, newPath, oldPath),
  };
}

/** `files` with each file the reader compared swapped for its compared
 *  diff, once that has arrived. */
export function withCompared(
  files: FileDiff[],
  asks: CompareAsk[],
  lookup: ComparedLookup,
): FileDiff[] {
  return files.map((file) => {
    if (file.status === "deleted") return file;
    const ask = asks.find((each) => each.newPath === afterPathOf(file));
    const answer = ask === undefined ? null : lookup(ask);
    return answer?.status === "ready" ? answer.data : file;
  });
}

/** What a file can be compared with, and what it is compared with now. */
export interface FileCompare {
  /** The before-side path the file is read against, or null for its own
   *  diff. */
  against: string | null;
  /** The before-side paths the row's own files name. */
  inRow: string[];
  /** The whole before tree, or null until it is asked for. */
  beforePaths: AsyncState<string[]> | null;
  onWantBeforePaths: () => void;
  /** Null puts the file's own diff back. */
  onCompare: (oldPath: string | null) => void;
}

/** The before-side paths a row's own files name, which the picker offers
 *  first. */
export function beforePathsOf(files: FileDiff[]): string[] {
  return files.flatMap((file) => {
    if (file.status === "added") return [];
    return ["path" in file ? file.path : file.oldPath];
  });
}
// ~/~ end
