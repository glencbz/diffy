// ~/~ begin <<docs/architecture/frontend/series-review.md#frontend-state-row-diffs>>[init]
import { useEffect, useRef, useState } from "react";
import { fetchLocalDiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
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
// ~/~ end
