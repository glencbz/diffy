// ~/~ begin <<docs/architecture/frontend/pairing.md#frontend-state-pairing>>[init]
import { useState } from "react";
import { alignSeries, type SeriesCommit } from "../../backend/commit/series";

export type Side = "left" | "right";

/** One row of the comparison: which commit faces which. Either side may be
 *  empty, and never both. */
export interface Slot {
  left: string | null;
  right: string | null;
}

/** The heuristic pairing, read off `alignSeries` by commit id. */
export function heuristicSlots(
  before: SeriesCommit[],
  after: SeriesCommit[],
): Slot[] {
  return alignSeries(before, after).map((pair) => ({
    left: pair.from?.commitId ?? null,
    right: pair.to?.commitId ?? null,
  }));
}

function hasCard(slots: Slot[], side: Side, row: number): boolean {
  const slot = slots[row];
  return slot !== undefined && slot[side] !== null;
}

/** Row indexes the card at `slots[index][side]` may move to: the blanks on
 *  its own side, strictly between its nearest neighbours above and below. */
export function legalTargets(
  slots: Slot[],
  side: Side,
  index: number,
): number[] {
  let start = 0;
  for (let row = index - 1; row >= 0; row -= 1) {
    if (hasCard(slots, side, row)) {
      start = row + 1;
      break;
    }
  }

  let end = slots.length - 1;
  for (let row = index + 1; row < slots.length; row += 1) {
    if (hasCard(slots, side, row)) {
      end = row - 1;
      break;
    }
  }

  const targets: number[] = [];
  for (let row = start; row <= end; row += 1) {
    if (row !== index) targets.push(row);
  }
  return targets;
}

function withSide(slot: Slot, side: Side, value: string | null): Slot {
  return side === "left" ? { ...slot, left: value } : { ...slot, right: value };
}

function dropEmpty(slots: Slot[]): Slot[] {
  return slots.filter((slot) => slot.left !== null || slot.right !== null);
}

/** Move the card at `slots[from][side]` into `slots[to][side]`. Refuses a
 *  target that is occupied or out of range. Drops any slot both sides have
 *  left afterward. */
export function moved(
  slots: Slot[],
  side: Side,
  from: number,
  to: number,
): Slot[] {
  const fromSlot = slots[from];
  const toSlot = slots[to];
  if (fromSlot === undefined || toSlot === undefined || toSlot[side] !== null) {
    return slots;
  }

  const next = slots.slice();
  next[to] = withSide(toSlot, side, fromSlot[side]);
  next[from] = withSide(fromSlot, side, null);

  return dropEmpty(next);
}

/** Move the card at `slots[index][side]` one row in `step`'s direction. If
 *  the neighbouring row is free on that side, this is `moved`. If the
 *  neighbour is a card, a fresh blank row opens on that side first, so the
 *  card can always travel without passing it. */
export function nudged(
  slots: Slot[],
  side: Side,
  index: number,
  step: -1 | 1,
): Slot[] {
  const target = index + step;
  if (legalTargets(slots, side, index).includes(target)) {
    return moved(slots, side, index, target);
  }

  const insertAt = step === -1 ? index : index + 1;
  const withBlank = [
    ...slots.slice(0, insertAt),
    { left: null, right: null },
    ...slots.slice(insertAt),
  ];
  const newIndex = index + (step === -1 ? 1 : 0);

  return moved(withBlank, side, newIndex, newIndex + step);
}

export interface Pairing {
  slots: Slot[];
  legalTargets: (side: Side, index: number) => number[];
  move: (side: Side, from: number, to: number) => void;
  nudge: (side: Side, index: number, step: -1 | 1) => void;
  /** Throw away the reader's edits and take the heuristic again. */
  reset: () => void;
  /** Whether the reader has changed anything. */
  edited: boolean;
}

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
