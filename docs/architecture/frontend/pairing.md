# Pairing

A pull request's commits carry a `changeId` guessed from their subject line,
and [`alignSeries`](../backend/series.md) uses it to decide which commit on
an old head faces which commit on a new one. A guess can be wrong. Two
unrelated commits can share a subject, or a rebase can change what a commit
became in a way the subject never followed. The reader has to be able to say
"no, put this one there instead," and a guess the reader cannot correct is
not good enough to build a review screen on.

That is why the pairing is a `Slot[]` the reader edits, not a value
recomputed from `before` and `after` on every render. A purely derived
pairing would throw the reader's correction away the instant anything else on
the page caused a re-render, and a correction is kept past the page as well,
so the next visit to the same two heads reads it back.

## Moving a card

A slot's `left` holds a `before` commit id, `right` holds an `after` commit
id, and a card moves by changing which slot holds it. It may only travel
through slots that are blank on its own side, and only as far as the nearest
slot already holding a card on that side, above or below. Passing that
neighbour would let the reader put an older `before` commit after a newer
one, or the same mistake on the `after` side, and a column's order is not the
reader's to set. It is that version's real history, jj's or GitHub's,
however it lines up against the other side. The reader chooses what a commit
faces, never when it happened.

`legalTargets` finds that pair of neighbours by walking outward from the card
in both directions and returns everything strictly between them. `moved`
performs the move if the target slot is free on that side, and drops any slot
both sides have left, so a card that leaves nothing behind in its old slot
does not leave a blank line nothing points to.

`nudged` moves a card one row at a time. When the neighbouring row is free on
that side, that is just `moved`. When the neighbour is a card, there is
nowhere to put the moving card without passing it, so `nudged` opens a fresh
blank row on that side and moves into that instead. A card can always travel
one step, even in a column packed shoulder to shoulder, and the blank
collapses again the moment nothing needs it, since `moved` drops empty rows
on every call.

## Recomputing the heuristic

`heuristicSlots` calls `alignSeries` and reads `commitId` off each side of
its answer. A pairing runs oldest first, the order the pull request screen
reads in, and `alignSeries` keeps `jj log`'s newest-first convention, so
`heuristicSlots` turns both series around on the way in and the answer
around on the way out. It is not a new algorithm, because `alignSeries` already answers
the question this heuristic needs answered, over the same two lists, and it
is already tested against the reorders, drops, and inserts a pull request's
history actually produces. A second heuristic here would mean keeping two
implementations of "which commit probably faces which" agreeing with each
other, for no gain a reader would notice over calling the one that already
exists.

`usePairing` calls `heuristicSlots` once for the initial state and again
whenever `before` or `after` change identity. The pull request's commits are
being read afresh at that point, so a pairing built against the old commits
no longer describes anything on screen.

```ts
//| id: frontend-model-pairing
//| file: src/frontend/model/pairing.ts
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

```

## Keeping a correction

A correction is kept in the [review document](review.md#review-state), under
the series and the two heads it pairs, and read back whenever the reader
opens the same two heads again, in this browser or any other. A correction
made against other heads describes commits that are not on screen, so it is
applied nowhere else. Every move sends the whole pairing as it now stands,
and `reset` sends none, which forgets the correction and puts the guess
back, for a reader who wants it without switching to a different pull
request to get it.

The pairing on screen is the kept one if there is one, then any edits with
nowhere to be kept, then the guess. A kept pairing is checked against the
series before it is used: every commit on each side once, in its series'
order, which is what `fits` asks. Two heads name the same commits every time,
so a pairing that fails is one written by something other than this screen,
and the guess serves better than a pairing that points at nothing. Edits
with nowhere to be kept are the reader's moves while the review document
has not loaded or cannot be read. They hold until the series change, as
every edit did before there was a document to keep them in.

The key each row is [filed under](review.md#review-state) is read through
the pairing, so a kept correction also keeps the reader's marks and comments
on the commits they paired by hand.

```ts
//| id: frontend-state-pairing
//| file: src/frontend/state/pairing.ts
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
```

`heuristicSlots`'s own tests fixture `SeriesCommit` lists directly, the same
way `series.test.ts` does, since `alignSeries`'s behaviour against a reorder
or a drop is already proven there. These tests only need to check the
mapping onto `Slot` sitting on top of it.

The 500-move test is the one that matters. `legalTargets`, `moved`, and
`nudged` are three separate functions agreeing to never let a card skip its
neighbour, and a unit test on each in isolation cannot show that the
agreement still holds once hundreds of moves compose. A property test can:
build a pairing, apply five hundred random legal nudges, and check that
reading each column top to bottom still names the same commits in the same
order it started with. The generator is a tiny seeded LCG rather than
`Math.random`, so a failure is the same failure on every run and worth
chasing rather than a flake to shrug off.

```ts
//| id: frontend-model-pairing-test
//| file: src/frontend/model/pairing.test.ts
import { describe, expect, test } from "bun:test";
import type { SeriesCommit } from "../../backend/commit/series";
import {
  fits,
  heuristicSlots,
  legalTargets,
  moved,
  nudged,
  type Side,
  type Slot,
} from "./pairing";

/** `"a b c"` -> that series, oldest first, each commit its own version. */
function series(changes: string, version = "1"): SeriesCommit[] {
  return changes
    .split(" ")
    .map((changeId) => ({ changeId, commitId: `${changeId}${version}` }));
}

/** A tiny seeded linear congruential generator, so a failing run reproduces
 *  the exact same sequence of moves every time rather than a flake that
 *  cannot be chased down. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("heuristicSlots", () => {
  test("pairs two identical series one to one", () => {
    // arrange
    const before = series("a b c");
    const after = series("a b c", "2");

    // act
    const slots = heuristicSlots(before, after);

    // assert
    expect(slots).toEqual([
      { left: "a1", right: "a2" },
      { left: "b1", right: "b2" },
      { left: "c1", right: "c2" },
    ]);
  });

  test("gives a commit only in the new series a slot with left: null", () => {
    // arrange
    const before = series("a");
    const after = series("a b", "2");

    // act
    const slots = heuristicSlots(before, after);

    // assert
    expect(slots).toContainEqual({ left: null, right: "b2" });
  });

  test("gives a commit only in the old series a slot with right: null", () => {
    // arrange
    const before = series("a b");
    const after = series("b", "2");

    // act
    const slots = heuristicSlots(before, after);

    // assert
    expect(slots).toContainEqual({ left: "a1", right: null });
  });
});

describe("legalTargets", () => {
  test("returns the blanks between a card's own neighbours and nothing past them", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: null },
      { left: null, right: null },
      { left: null, right: null },
      { left: null, right: null },
      { left: "b", right: null },
    ];

    // act
    const targets = legalTargets(slots, "left", 0);

    // assert
    expect(targets).toEqual([1, 2, 3]);
  });

  test("returns nothing when the card is boxed in on both sides", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: null },
      { left: "b", right: null },
      { left: "c", right: null },
    ];

    // act
    const targets = legalTargets(slots, "left", 1);

    // assert
    expect(targets).toEqual([]);
  });
});

describe("moved", () => {
  test("pairs two commits when one lands opposite the other", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: "p" },
      { left: null, right: "x" },
    ];

    // act
    const next = moved(slots, "left", 0, 1);

    // assert
    expect(next).toEqual([
      { left: null, right: "p" },
      { left: "a", right: "x" },
    ]);
  });

  test("refuses a target that is already occupied", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: null },
      { left: "b", right: null },
    ];

    // act
    const next = moved(slots, "left", 0, 1);

    // assert
    expect(next).toBe(slots);
  });

  test("drops a row that both cards have left", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: null },
      { left: null, right: "x" },
    ];

    // act
    const next = moved(slots, "left", 0, 1);

    // assert
    expect(next).toEqual([{ left: "a", right: "x" }]);
  });
});

describe("nudged", () => {
  test("makes a blank when the neighbour is adjacent", () => {
    // arrange
    const slots: Slot[] = [
      { left: "a", right: "x" },
      { left: "b", right: "y" },
    ];

    // act
    const next = nudged(slots, "left", 0, 1);

    // assert
    expect(next).toEqual([
      { left: null, right: "x" },
      { left: "a", right: null },
      { left: "b", right: "y" },
    ]);
  });

  test("keeps a column's order through 500 random legal nudges", () => {
    // arrange
    const before = series("a b c d e f");
    const after = series("c a d f b e", "2");
    let slots = heuristicSlots(before, after);
    const rng = lcg(20260923);

    // act
    for (let i = 0; i < 500; i += 1) {
      const side: Side = rng() < 0.5 ? "left" : "right";
      const candidates = slots
        .map((slot, index) => (slot[side] !== null ? index : -1))
        .filter((index) => index !== -1);
      const pick = candidates[Math.floor(rng() * candidates.length)];
      if (pick === undefined) continue;
      const step: -1 | 1 = rng() < 0.5 ? -1 : 1;
      slots = nudged(slots, side, pick, step);
    }

    // assert
    const leftOrder = slots
      .map((slot) => slot.left)
      .filter((id): id is string => id !== null);
    const rightOrder = slots
      .map((slot) => slot.right)
      .filter((id): id is string => id !== null);
    expect(leftOrder).toEqual(before.map((commit) => commit.commitId));
    expect(rightOrder).toEqual(after.map((commit) => commit.commitId));
  });
});
describe("fits", () => {
  const before = series("a b", "1");
  const after = series("a b", "2");

  test("accepts a pairing of exactly these series, however it pairs them", () => {
    // arrange
    const swapped: Slot[] = [
      { left: "a1", right: null },
      { left: "b1", right: "a2" },
      { left: null, right: "b2" },
    ];

    // act
    // assert
    expect(fits(heuristicSlots(before, after), before, after)).toBe(true);
    expect(fits(swapped, before, after)).toBe(true);
  });

  test("refuses a pairing that misses, repeats, or reorders a commit", () => {
    // arrange
    const pairings: Slot[][] = [
      [{ left: "a1", right: "a2" }],
      [
        { left: "a1", right: "a2" },
        { left: "b1", right: "a2" },
      ],
      [
        { left: "b1", right: "a2" },
        { left: "a1", right: "b2" },
      ],
      [
        { left: "a1", right: "a2" },
        { left: null, right: null },
        { left: "b1", right: "b2" },
      ],
    ];

    // act
    // assert
    for (const slots of pairings)
      expect(fits(slots, before, after)).toBe(false);
  });
});
```
