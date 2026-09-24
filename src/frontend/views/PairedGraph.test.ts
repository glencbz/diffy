// ~/~ begin <<docs/architecture/frontend/paired-graph.md#frontend-view-paired-graph-test>>[init]
import { describe, expect, test } from "bun:test";
import type { Slot } from "../state/pairing";
import { rowKind } from "./PairedGraph";

describe("rowKind", () => {
  test("reads a slot with nothing on the old side as added", () => {
    // arrange
    const slot: Slot = { left: null, right: "a2" };

    // act
    const kind = rowKind(slot);

    // assert
    expect(kind).toBe("added");
  });

  test("reads a slot with nothing on the new side as dropped", () => {
    // arrange
    const slot: Slot = { left: "a1", right: null };

    // act
    const kind = rowKind(slot);

    // assert
    expect(kind).toBe("dropped");
  });

  test("reads a slot with a commit on both sides as paired", () => {
    // arrange
    const slot: Slot = { left: "a1", right: "a2" };

    // act
    const kind = rowKind(slot);

    // assert
    expect(kind).toBe("paired");
  });
});
// ~/~ end
