// ~/~ begin <<docs/architecture/frontend/address.md#frontend-model-place-test>>[init]
import { describe, expect, test } from "bun:test";
import { GitOid } from "../../model/history";
import { type Place, readPlace, readRepo, withRepo, writePlace } from "./place";

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

  test("reads every part of a local review down to a line", () => {
    // arrange
    const address = `/reviews/stack/commits/${oid("c")}/files/src/server.ts?from=1&to=2#L120`;

    // act
    const place = at(address);

    // assert
    expect(place).toEqual({
      tab: "reviews",
      review: {
        name: "stack",
        from: { kind: "version", id: "1" },
        to: "2",
        spot: {
          commit: oid("c"),
          file: { path: "src/server.ts", line: 120 },
        },
      },
    });
  });

  test("keeps the file when its line does not parse", () => {
    const place = at(`/reviews/x/commits/${oid("c")}/files/a.ts#L0`);

    expect(place).toEqual({
      tab: "reviews",
      review: {
        name: "x",
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "a.ts", line: null } },
      },
    });
  });

  test("drops a file whose commit does not parse", () => {
    const place = at("/reviews/x/commits/abc/files/a.ts#L3");

    expect(place).toEqual({
      tab: "reviews",
      review: { name: "x", from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("keeps the commit when its file does not decode", () => {
    const place = at(`/reviews/x/commits/${oid("c")}/files/%E0%A4%A#L3`);

    expect(place).toEqual({
      tab: "reviews",
      review: {
        name: "x",
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: null },
      },
    });
  });

  test("reads a local review by name, its versions by number", () => {
    const place = at(`/reviews/stack%2Fone/commits/${oid("c")}?from=2&to=3`);

    expect(place).toEqual({
      tab: "reviews",
      review: {
        name: "stack/one",
        from: { kind: "version", id: "2" },
        to: "3",
        spot: { commit: oid("c"), file: null },
      },
    });
  });

  test("opens a local review afresh when a version is not a number", () => {
    expect(at("/reviews/stack?from=v2")).toEqual({
      tab: "reviews",
      review: { name: "stack", from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("reads a path it does not know as the local history screen", () => {
    expect(at("/nowhere/41")).toEqual({ tab: "local" });
  });
});

describe("writePlace", () => {
  const places: Place[] = [
    { tab: "local" },
    { tab: "settings" },
    {
      tab: "reviews",
      review: {
        name: "stack",
        from: { kind: "base" },
        to: "2",
        spot: {
          commit: oid("c"),
          file: { path: "dir/a file&more#?.ts", line: 3 },
        },
      },
    },
    { tab: "reviews", review: null },
    {
      tab: "reviews",
      review: {
        name: "stack/one",
        from: { kind: "version", id: "1" },
        to: "2",
        spot: { commit: oid("c"), file: { path: "src/a.ts", line: 9 } },
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
      tab: "reviews",
      review: {
        name: "stack",
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "src/a.ts", line: 3 } },
      },
    });

    expect(address).toBe(
      `/reviews/stack/commits/${oid("c")}/files/src/a.ts#L3`,
    );
  });
});

describe("the tab's repository", () => {
  test("rides beside the place without changing it", () => {
    // arrange
    const address = withRepo("/reviews/x?from=2#L4", "/src/a b");

    // act
    const place = at(address);

    // assert
    expect(readRepo(new URL(address, "http://diffy"))).toBe("/src/a b");
    expect(place).toEqual(at("/reviews/x?from=2#L4"));
    expect(withRepo("/", null)).toBe("/");
  });
});
// ~/~ end
