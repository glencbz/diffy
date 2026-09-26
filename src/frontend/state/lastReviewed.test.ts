// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed-test>>[init]
import { describe, expect, test } from "bun:test";
import { GitOid, type PullVersion } from "../api";
import { opening } from "./lastReviewed";
import { openPull, type PullPlace } from "./place";

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
// ~/~ end
