// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed-test>>[init]
import { describe, expect, test } from "bun:test";
import { lastReviewed, opening } from "./lastReviewed";
import { openPull, type PullPlace } from "./place";
import type { ReviewedVersion } from "./review";
import type { SeriesVersion } from "./series";

function version(number: number, id: string): SeriesVersion {
  return { id, number, label: "" };
}

describe("opening", () => {
  const versions = [version(1, "a"), version(2, "b"), version(3, "c")];

  test("opens a bare address on the changes since the version last reviewed", () => {
    expect(opening(openPull(7), "a", versions)).toEqual({
      number: 7,
      from: { kind: "version", id: "a" },
      to: null,
      spot: null,
    });
  });

  test("opens whole when nothing was reviewed", () => {
    expect(opening(openPull(7), null, versions)).toEqual(openPull(7));
  });

  test("opens whole when the latest version is the one reviewed", () => {
    expect(opening(openPull(7), "c", versions)).toEqual(openPull(7));
  });

  test("opens whole when the version reviewed is no longer in the history", () => {
    expect(opening(openPull(7), "f", versions)).toEqual(openPull(7));
  });

  test("leaves an address that names anything past the number alone", () => {
    const places: PullPlace[] = [
      { ...openPull(7), to: "c" },
      { ...openPull(7), from: { kind: "version", id: "b" } },
      { ...openPull(7), to: "c", spot: { commit: "d", file: null } },
    ];

    for (const place of places) {
      expect(opening(place, "a", versions)).toEqual(place);
    }
  });
});

describe("lastReviewed", () => {
  const versions = [version(1, "a"), version(2, "b"), version(3, "c")];

  function mark(id: string, reviewedAt: string): ReviewedVersion {
    return { series: "pull:o/r#7", version: id, reviewedAt };
  }

  test("takes the newest version marked, whenever it was marked", () => {
    // arrange
    const marked = [mark("b", "t1"), mark("a", "t2")];

    // act
    // assert
    expect(lastReviewed(marked, versions)).toBe("b");
  });

  test("takes the version marked last when the history lists none", () => {
    // arrange
    const marked = [mark("e", "t2"), mark("f", "t1")];

    // act
    // assert
    expect(lastReviewed(marked, versions)).toBe("e");
  });

  test("reads nothing reviewed when nothing is marked", () => {
    expect(lastReviewed([], versions)).toBeNull();
  });
});
// ~/~ end
