// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-row-diffs>>[init]
import { useEffect, useRef, useState } from "react";
import {
  type FileDiff,
  fetchPullDiff,
  GitOid,
  type PullBaseline,
  type PullDiffScope,
} from "../api";
import type { AsyncState } from "./asyncState";
import type { Slot } from "./pairing";

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
// ~/~ end
