// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-model-local-history>>[init]
import type { OpLogEntry } from "../api";

/**
 * Which operation a local side reads the repo at. A `latest` side asked for
 * the newest, and `at` is what was newest when it asked.
 */
export type OperationPick =
  | { kind: "latest"; at: string }
  | { kind: "pinned"; at: string };

export interface LocalSide {
  pick: OperationPick;
  commits: string[];
}

export type LocalHistory =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      operations: OpLogEntry[];
      before: LocalSide;
      after: LocalSide;
    };
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-model-local-history>>[1]

export function withOperations(
  history: LocalHistory,
  operations: OpLogEntry[],
): LocalHistory {
  const head = operations[0];
  if (head === undefined) return history;
  if (history.status !== "ready") {
    return {
      status: "ready",
      operations,
      before: { pick: { kind: "latest", at: head.id }, commits: [] },
      after: { pick: { kind: "latest", at: head.id }, commits: [] },
    };
  }
  if (history.operations[0]?.id === head.id) return history;
  return { ...history, operations };
}

/** What picking `operationId` from the dropdown means for a side; `null` is
 *  "latest (current)". */
export function pick(head: string, operationId: string | null): OperationPick {
  return operationId === null
    ? { kind: "latest", at: head }
    : { kind: "pinned", at: operationId };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-model-local-history>>[2]

/** The newest operation a "latest" side has not moved to yet, or `null` when
 *  the side is pinned or already at the newest. */
export function newerOperation(
  side: LocalSide,
  operations: OpLogEntry[],
): OpLogEntry | null {
  const head = operations[0];
  if (head === undefined || side.pick.kind !== "latest") return null;
  return side.pick.at === head.id ? null : head;
}

/** What `OperationPicker` shows for a pick: `null` ("latest (current)") only
 *  when the side is latest and already at the head, its pinned operation id
 *  otherwise. */
export function pickerValue(
  sidePick: OperationPick,
  head: string,
): string | null {
  return sidePick.kind === "latest" && sidePick.at === head
    ? null
    : sidePick.at;
}
// ~/~ end
