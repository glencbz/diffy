// ~/~ begin <<docs/architecture/frontend/pairing.md#frontend-state-pairing>>[init]
import { useState } from "react";
import type { SeriesCommit } from "../../backend/commit/series";
import {
  fits,
  heuristicSlots,
  legalTargets,
  moved,
  nudged,
  type Pairing,
  type Slot,
} from "../model/pairing";

/** Where a correction to the pairing is kept, when there is somewhere to
 *  keep it: what was kept for these two series, and how to keep another. */
export interface KeptSlots {
  slots: Slot[] | null;
  keep: (slots: Slot[] | null) => void;
}

/** The heuristic for a pair of series, and the reader's edits to it that
 *  have nowhere to be kept. */
function fresh(before: SeriesCommit[], after: SeriesCommit[]) {
  return {
    before,
    after,
    heuristic: heuristicSlots(before, after),
    edits: null as Slot[] | null,
  };
}

export function usePairing(
  before: SeriesCommit[],
  after: SeriesCommit[],
  kept: KeptSlots | null,
): Pairing {
  const [state, setState] = useState(() => fresh(before, after));

  // Picking a different version hands this hook two new series, and the
  // pairing on screen describes neither of them. Recomputing during the
  // render that brought them in beats an effect, which would paint the old
  // pairing against the new commits for one frame first.
  let current = state;
  if (state.before !== before || state.after !== after) {
    current = fresh(before, after);
    setState(current);
  }

  const keptSlots =
    kept?.slots != null && fits(kept.slots, before, after) ? kept.slots : null;
  const slots = keptSlots ?? current.edits ?? current.heuristic;
  const change = (next: Slot[] | null) => {
    if (kept !== null) kept.keep(next);
    else setState((now) => ({ ...now, edits: next }));
  };

  return {
    slots,
    legalTargets: (side, index) => legalTargets(slots, side, index),
    move: (side, from, to) => change(moved(slots, side, from, to)),
    nudge: (side, index, step) => change(nudged(slots, side, index, step)),
    reset: () => change(null),
    edited: slots !== current.heuristic,
  };
}
// ~/~ end
