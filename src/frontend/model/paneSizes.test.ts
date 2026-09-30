// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-model-pane-sizes-test>>[init]
import { describe, expect, test } from "bun:test";
import { clampSize, REST } from "./paneSizes";

describe("clampSize", () => {
  test("keeps a size that fits", () => {
    // arrange
    const room = 1000;

    // act
    const size = clampSize("local-before", 300, room);

    // assert
    expect(size).toBe(300);
  });

  test("stops at the pane's minimum", () => {
    // act
    const size = clampSize("local-before", 20, 1000);

    // assert
    expect(size).toBe(160);
  });

  test("leaves the pane giving way its rest", () => {
    // arrange
    const room = 1000;

    // act
    const size = clampSize("pull-commits", 950, room);

    // assert
    expect(size).toBe(room - REST);
  });

  test("keeps the minimum when the room cannot hold both", () => {
    // act
    const size = clampSize("local-after", 300, 250);

    // assert
    expect(size).toBe(160);
  });

  test("rounds to a whole pixel", () => {
    // act
    const size = clampSize("pull-commits", 120.6, 1000);

    // assert
    expect(size).toBe(121);
  });
});
// ~/~ end
