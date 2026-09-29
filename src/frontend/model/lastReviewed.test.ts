// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-model-last-reviewed-test>>[init]
import { describe, expect, test } from "bun:test";
import { GitOid, type PullVersion } from "../api";
import { lastReviewed, opening } from "./lastReviewed";
import { openPull, type PullPlace } from "./place";
import type { ReviewedVersion } from "./review";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function version(n: number, ch: string): PullVersion {
  return { version: n, head: oid(ch), origin: { kind: "opened" } };
}

describe("opening", () => {
  const states = [version(1, "a"), version(2, "b"), version(3, "c")];

  test("opens a bare address on the changes since the head last reviewed", () => {
    expect(opening(openPull(7), oid("a"), states)).toEqual({
      number: 7,
      from: { kind: "version", head: oid("a") },
      to: null,
      spot: null,
    });
  });

  test("opens whole when nothing was reviewed", () => {
    expect(opening(openPull(7), null, states)).toEqual(openPull(7));
  });

  test("opens whole when the latest head is the one reviewed", () => {
    expect(opening(openPull(7), oid("c"), states)).toEqual(openPull(7));
  });

  test("opens whole when the head reviewed is no longer in the history", () => {
    expect(opening(openPull(7), oid("f"), states)).toEqual(openPull(7));
  });

  test("leaves an address that names anything past the number alone", () => {
    const places: PullPlace[] = [
      { ...openPull(7), to: oid("c") },
      { ...openPull(7), from: { kind: "version", head: oid("b") } },
      { ...openPull(7), to: oid("c"), spot: { commit: oid("d"), file: null } },
    ];

    for (const place of places) {
      expect(opening(place, oid("a"), states)).toEqual(place);
    }
  });
});

describe("lastReviewed", () => {
  const states = [version(1, "a"), version(2, "b"), version(3, "c")];

  function mark(ch: string, reviewedAt: string): ReviewedVersion {
    return { series: "pull:o/r#7", version: oid(ch), reviewedAt };
  }

  test("takes the newest head marked, whenever it was marked", () => {
    // arrange
    const marked = [mark("b", "t1"), mark("a", "t2")];

    // act
    // assert
    expect(lastReviewed(marked, states)).toBe(oid("b"));
  });

  test("takes the head marked last when the history lists none", () => {
    // arrange
    const marked = [mark("e", "t2"), mark("f", "t1")];

    // act
    // assert
    expect(lastReviewed(marked, states)).toBe(oid("e"));
  });

  test("reads nothing reviewed when nothing is marked", () => {
    expect(lastReviewed([], states)).toBeNull();
  });
});
// ~/~ end
