// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-row-diffs>>[init]
import { useEffect, useRef, useState } from "react";
import { fetchLocalDiff, fetchPullDiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import { GitOid } from "../model/history";
import type { Slot } from "../model/pairing";
import type { PullDiffScope } from "../model/pull";
import type { RowAsk } from "../model/series";

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

/** One slot's comparison, or null for a slot with no commit in it. */
function slotDiff(ask: RowAsk, slot: Slot): Promise<FileDiff[]> | null {
  if (slot.left === null && slot.right === null) return null;
  if (ask.kind === "local") return fetchLocalDiff(slot.left, slot.right);
  const scope = slotScope(slot);
  if (scope === null) return null;
  return fetchPullDiff(ask.repo, ask.number, ask.to, ask.from, scope).then(
    (answer) => answer.files,
  );
}

export type RowDiffs = Map<string, AsyncState<FileDiff[]>>;

const NO_DIFFS: RowDiffs = new Map();

/** The comparison behind each row, keyed the way a row is keyed. */
export function useRowDiffs(ask: RowAsk, slots: Slot[]): RowDiffs {
  const of = JSON.stringify(ask);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `of` stands for `ask`
  useEffect(() => {
    if (asked.current.of !== of) asked.current = { of, keys: new Set() };
    const { keys } = asked.current;

    for (const slot of slots) {
      const key = slotKey(slot);
      if (keys.has(key)) continue;
      const diff = slotDiff(ask, slot);
      if (diff === null) continue;
      keys.add(key);

      const put = (value: AsyncState<FileDiff[]>) => {
        if (asked.current.of !== of) return;
        setState((now) => ({
          of,
          cache: new Map(now.of === of ? now.cache : []).set(key, value),
        }));
      };
      diff.then(
        (files) => put({ status: "ready", data: files }),
        (err: unknown) => put({ status: "error", message: String(err) }),
      );
    }
  }, [of, slots]);

  return state.of === of ? state.cache : NO_DIFFS;
}
// ~/~ end
