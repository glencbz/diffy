// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place-test>>[init]
import { describe, expect, test } from "bun:test";
import { GitOid } from "../api";
import { type Place, readPlace, writePlace } from "./place";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function at(address: string): Place {
  return readPlace(new URL(address, "http://diffy"));
}

describe("readPlace", () => {
  test("reads the root as the local history screen", () => {
    expect(at("/")).toEqual({ tab: "local" });
  });

  test("reads every part of a pull request down to a line", () => {
    // arrange
    const address = `/pulls/41/commits/${oid("c")}/files/src/server.ts?from=${oid("a")}&to=${oid("b")}#L120`;

    // act
    const place = at(address);

    // assert
    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "version", head: oid("a") },
        to: oid("b"),
        spot: {
          commit: oid("c"),
          file: { path: "src/server.ts", line: 120 },
        },
      },
    });
  });

  test("keeps the file when its line does not parse", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/a.ts#L0`);

    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "a.ts", line: null } },
      },
    });
  });

  test("drops a file whose commit does not parse", () => {
    const place = at("/pulls/41/commits/abc/files/a.ts#L3");

    expect(place).toEqual({
      tab: "pulls",
      pull: { number: 41, from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("keeps the commit when its file does not decode", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/%E0%A4%A#L3`);

    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: null },
      },
    });
  });

  test("opens the pull request afresh when a head does not parse", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/a.ts?to=abc`);

    expect(place).toEqual({
      tab: "pulls",
      pull: { number: 41, from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("reads a pull number that is not a number as the list", () => {
    expect(at("/pulls/x")).toEqual({ tab: "pulls", pull: null });
  });

  test("reads a path it does not know as the local history screen", () => {
    expect(at("/nowhere/41")).toEqual({ tab: "local" });
  });
});

describe("writePlace", () => {
  const places: Place[] = [
    { tab: "local" },
    { tab: "settings" },
    { tab: "pulls", pull: null },
    {
      tab: "pulls",
      pull: { number: 7, from: { kind: "base" }, to: null, spot: null },
    },
    {
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "version", head: oid("a") },
        to: oid("b"),
        spot: { commit: oid("c"), file: null },
      },
    },
    {
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "base" },
        to: oid("b"),
        spot: {
          commit: oid("c"),
          file: { path: "dir/a file&more#?.ts", line: 3 },
        },
      },
    },
  ];

  for (const place of places) {
    test(`reads back ${JSON.stringify(place)}`, () => {
      expect(at(writePlace(place))).toEqual(place);
    });
  }

  test("keeps the slashes of a file's path readable", () => {
    const address = writePlace({
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "src/a.ts", line: 3 } },
      },
    });

    expect(address).toBe(`/pulls/7/commits/${oid("c")}/files/src/a.ts#L3`);
  });
});
// ~/~ end
