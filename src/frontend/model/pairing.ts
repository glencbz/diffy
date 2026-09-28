// ~/~ begin <<docs/architecture/frontend/pairing.md#frontend-model-pairing>>[init]
import { alignSeries, type SeriesCommit } from "../../backend/commit/series";

export type Side = "left" | "right";

/** One row of the comparison: which commit faces which. Either side may be
 *  empty, and never both. */
export interface Slot {
  left: string | null;
  right: string | null;
}

/** The heuristic pairing, read off `alignSeries` by commit id. Both series
 *  and the slots run oldest first. */
export function heuristicSlots(
  before: SeriesCommit[],
  after: SeriesCommit[],
): Slot[] {
  return alignSeries([...before].reverse(), [...after].reverse())
    .reverse()
    .map((pair) => ({
      left: pair.from?.commitId ?? null,
      right: pair.to?.commitId ?? null,
    }));
}

/** Whether `slots` pairs exactly these two series: every commit on each
 *  side once, in the order its series runs. */
export function fits(
  slots: Slot[],
  before: SeriesCommit[],
  after: SeriesCommit[],
): boolean {
  const ids = (side: Side) =>
    slots.flatMap((slot) => (slot[side] === null ? [] : [slot[side]]));
  const same = (a: (string | null)[], b: SeriesCommit[]) =>
    a.length === b.length && a.every((id, index) => id === b[index]?.commitId);
  return (
    slots.every((slot) => slot.left !== null || slot.right !== null) &&
    same(ids("left"), before) &&
    same(ids("right"), after)
  );
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

// ~/~ end
