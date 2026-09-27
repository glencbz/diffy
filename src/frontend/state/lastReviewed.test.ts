// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import { GitOid, type PullVersion } from "../api";
import { load, opening, save } from "./lastReviewed";
import { openPull, type PullPlace } from "./place";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function version(n: number, ch: string): PullVersion {
  return { version: n, head: oid(ch), origin: { kind: "opened" } };
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

describe("load", () => {
  test("round-trips a head through save, per pull request", () => {
    // arrange
    save("o/r", 7, oid("a"));
    save("o/r", 8, oid("b"));

    // act
    // assert
    expect(load("o/r", 7)).toBe(oid("a"));
    expect(load("o/r", 8)).toBe(oid("b"));
    expect(load("o/other", 7)).toBeNull();
  });

  test("reads a value that does not parse as no mark, and keeps the others", () => {
    // arrange
    save("o/r", 8, oid("b"));
    localStorage.setItem("diffy.last-reviewed.v1:o/r#7", "not json");
    localStorage.setItem("diffy.last-reviewed.v1:o/r#9", '{"head":"abc"}');
    localStorage.setItem("diffy.session.v1", '{"marks":[],"comments":[]}');

    // act
    // assert
    expect(load("o/r", 7)).toBeNull();
    expect(load("o/r", 9)).toBeNull();
    expect(load("o/r", 8)).toBe(oid("b"));
    expect(localStorage.getItem("diffy.session.v1")).toBe(
      '{"marks":[],"comments":[]}',
    );
  });
});

describe("save", () => {
  test("does not throw when the store throws", () => {
    // arrange
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;

    // act
    // assert
    expect(() => save("o/r", 7, oid("a"))).not.toThrow();
  });
});

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
