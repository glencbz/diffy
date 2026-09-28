// ~/~ begin <<docs/architecture/frontend/pairing.md#frontend-state-pairing>>[init]
import { useState } from "react";
import type { SeriesCommit } from "../../backend/commit/series";
import {
  heuristicSlots,
  legalTargets,
  moved,
  nudged,
  type Pairing,
} from "../model/pairing";

/** The heuristic pairing for a pair of series, and no edits yet. */
function fresh(before: SeriesCommit[], after: SeriesCommit[]) {
  return { before, after, slots: heuristicSlots(before, after), edited: false };
}

export function usePairing(
  before: SeriesCommit[],
  after: SeriesCommit[],
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

  return {
    slots: current.slots,
    legalTargets: (side, index) => legalTargets(current.slots, side, index),
    move(side, from, to) {
      setState((now) => ({
        ...now,
        slots: moved(now.slots, side, from, to),
        edited: true,
      }));
    },
    nudge(side, index, step) {
      setState((now) => ({
        ...now,
        slots: nudged(now.slots, side, index, step),
        edited: true,
      }));
    },
    reset() {
      setState(fresh(before, after));
    },
    edited: current.edited,
  };
}

// ~/~ end
