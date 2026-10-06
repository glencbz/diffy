// ~/~ begin <<docs/architecture/frontend/combined-graph.md#frontend-model-combined-log>>[init]
import type { LogEntry } from "./history";

/** How a change moved between the before and the after operation. */
export type CombinedKind = "same" | "rewritten" | "new" | "gone";

export type CombinedRow = {
  /** The change id, or the commit id where a change id names no one row. */
  key: string;
  /** Row keys of the parents the graph draws. */
  parents: string[];
} & (
  | { kind: "same" | "rewritten"; before: LogEntry; after: LogEntry }
  | { kind: "new"; before: null; after: LogEntry }
  | { kind: "gone"; before: LogEntry; after: null }
);

/** The entry a row is labelled with: the after one unless the change is gone. */
export function rowEntry(row: CombinedRow): LogEntry {
  return row.kind === "gone" ? row.before : row.after;
}

/** Change ids that appear more than once on either side. */
function divergent(logs: LogEntry[][]): Set<string> {
  const found = new Set<string>();
  for (const log of logs) {
    const seen = new Set<string>();
    for (const { changeId } of log) {
      if (changeId === null) continue;
      if (seen.has(changeId)) found.add(changeId);
      seen.add(changeId);
    }
  }
  return found;
}

export function combineLogs(
  before: LogEntry[],
  after: LogEntry[],
): CombinedRow[] {
  const ambiguous = divergent([before, after]);
  const keyOf = ({ changeId, commitId }: LogEntry) =>
    changeId === null || ambiguous.has(changeId) ? commitId : changeId;
  const beforeKeys = new Map(before.map((e) => [e.commitId, keyOf(e)]));
  const afterKeys = new Map(after.map((e) => [e.commitId, keyOf(e)]));
  const beforeByKey = new Map(before.map((e) => [keyOf(e), e]));
  const kept = new Set(afterKeys.values());

  const parents = (entry: LogEntry, keys: Map<string, string>) =>
    entry.parents.map((parent) => keys.get(parent) ?? parent);

  // Each gone entry waits for the next before entry the after log still has.
  const goneAhead = new Map<string, LogEntry[]>();
  let waiting: LogEntry[] = [];
  for (const entry of before) {
    const key = keyOf(entry);
    if (!kept.has(key)) {
      waiting.push(entry);
    } else if (waiting.length > 0) {
      goneAhead.set(key, waiting);
      waiting = [];
    }
  }

  const gone = (entry: LogEntry): CombinedRow => ({
    key: keyOf(entry),
    parents: parents(entry, beforeKeys),
    kind: "gone",
    before: entry,
    after: null,
  });

  const rows: CombinedRow[] = [];
  for (const entry of after) {
    const key = keyOf(entry);
    rows.push(...(goneAhead.get(key) ?? []).map(gone));
    const was = beforeByKey.get(key);
    const common = { key, parents: parents(entry, afterKeys), after: entry };
    rows.push(
      was === undefined
        ? { ...common, kind: "new", before: null }
        : {
            ...common,
            kind: was.commitId === entry.commitId ? "same" : "rewritten",
            before: was,
          },
    );
  }
  rows.push(...waiting.map(gone));
  return rows;
}

/** The rows as log entries `layoutGraph` can lay out, one per row, linked by
 *  row key, so the combined graph needs no layout of its own. */
export function layoutEntries(rows: CombinedRow[]): LogEntry[] {
  return rows.map((row) => ({
    ...rowEntry(row),
    commitId: row.key,
    parents: row.parents,
  }));
}

/** A side's selection with `commitId` ticked or unticked, in that side's own
 *  log order, as its own graph would emit it. */
export function tick(
  log: LogEntry[],
  selected: string[],
  commitId: string,
): string[] {
  const next = new Set(selected);
  if (next.has(commitId)) next.delete(commitId);
  else next.add(commitId);
  return log
    .filter((entry) => next.has(entry.commitId))
    .map((entry) => entry.commitId);
}
// ~/~ end
