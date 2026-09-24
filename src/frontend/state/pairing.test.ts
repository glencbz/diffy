// ~/~ begin <<docs/architecture/frontend/pairing.md#frontend-state-pairing-test>>[init]
import { describe, expect, test } from "bun:test";
import type { SeriesCommit } from "../../backend/commit/series";
import {
  heuristicSlots,
  legalTargets,
  moved,
  nudged,
  type Side,
  type Slot,
} from "./pairing";

/** `"a b c"` -> that series, newest first, each commit its own version. */
function series(changes: string, version = "1"): SeriesCommit[] {
  return changes
    .split(" ")
    .reverse()
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
      { left: "c1", right: "c2" },
      { left: "b1", right: "b2" },
      { left: "a1", right: "a2" },
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
// ~/~ end
