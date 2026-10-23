// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-model-location-test>>[init]
import { describe, expect, test } from "bun:test";
import type { Component, ComponentPlace } from "./components";
import { codeAt, componentsAt, type Location, sameLocation } from "./location";

function component(
  id: string,
  places: Partial<ComponentPlace>[],
  commitId = "c1",
): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: places.map((place) => ({
      path: "a.ts",
      side: "after",
      start: 1,
      about: "",
      ...place,
    })),
  };
}

const line = (at: number, path = "a.ts"): Location => ({
  kind: "code",
  commit: "c1",
  path,
  side: "after",
  line: at,
});

describe("locations", () => {
  test("a line nested in two components is in the narrower first", () => {
    // arrange
    const outer = component("outer", [{ start: 1, end: 20 }]);
    const inner = component("inner", [{ start: 5, end: 8 }]);

    // act
    const found = componentsAt(line(6), [outer, inner]);

    // assert
    expect(found.map((each) => each.id)).toEqual(["inner", "outer"]);
  });

  test("a line on the other side or in another commit is in nothing", () => {
    // arrange
    const before = component("a", [{ side: "before", start: 1, end: 9 }]);
    const elsewhere = component("b", [{ start: 1, end: 9 }], "c2");

    // act
    const found = componentsAt(line(3), [before, elsewhere]);

    // assert
    expect(found).toEqual([]);
  });

  test("a component's code starts with the file being read", () => {
    // arrange
    const split = component("a", [
      { path: "a.ts", start: 4 },
      { path: "b.ts", start: 10 },
    ]);
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "b.ts",
    };

    // act
    const lines = codeAt(reading, [split]);

    // assert
    expect(lines.map((each) => `${each.path}:${each.line}`)).toEqual([
      "b.ts:10",
      "a.ts:4",
    ]);
  });

  test("locations of different kinds are never the same", () => {
    // arrange
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "a.ts",
    };

    // act
    const same = sameLocation(reading, line(1));

    // assert
    expect(same).toBe(false);
  });
});
// ~/~ end
