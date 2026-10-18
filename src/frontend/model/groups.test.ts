// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-groups-test>>[init]
import { describe, expect, test } from "bun:test";
import type { Component, ComponentGroup } from "./components";
import { arrange, arrangementsOf, groupLinks } from "./groups";

function component(
  id: string,
  paths: [string, number][],
  role: Component["role"] = "implements",
): Component {
  return {
    commitId: "c1",
    id,
    kind: "command",
    name: id,
    role,
    gist: "",
    words: [],
    mentions: [],
    places: paths.map(([path, lines]) => ({
      path,
      side: "after",
      start: 1,
      end: lines,
      about: "",
    })),
  };
}

const group = (id: string, components: string[]): ComponentGroup => ({
  commitId: "c1",
  id,
  name: id,
  gist: "",
  components,
});

describe("arrange", () => {
  const model = component("model", [["src/frontend/model/review.ts", 10]]);
  const view = component("view", [
    ["src/frontend/views/Comments.tsx", 20],
    ["src/frontend/model/review.ts", 1],
  ]);
  const agent = component("agent", [["src/backend/agent/review.ts", 3]]);
  const check = component(
    "check",
    [["src/frontend/model/review.test.ts", 30]],
    "tests",
  );

  test("by piece follows the agent's groups, then the rest", () => {
    const groups = arrange(
      "piece",
      [model, view, agent, check],
      [group("data", ["model", "agent"]), group("empty", ["gone"])],
    );
    expect(groups.map((each) => [each.name, each.ids])).toEqual([
      ["data", ["model", "agent"]],
      ["everything else", ["view", "check"]],
    ]);
  });

  test("by layer splits one folder below the shared one", () => {
    expect(
      arrange("layer", [model, view, agent, check], []).map((each) => [
        each.name,
        each.ids,
      ]),
    ).toEqual([
      ["backend", ["agent"]],
      ["frontend", ["model", "view"]],
      ["tests", ["check"]],
    ]);
  });

  test("by layer goes deeper when every file shares a folder", () => {
    expect(
      arrange("layer", [model, view], []).map((each) => [each.name, each.ids]),
    ).toEqual([
      ["model", ["model"]],
      ["views", ["view"]],
    ]);
  });

  test("by role keeps the roles' order and skips empty ones", () => {
    expect(
      arrange("role", [check, model], []).map((each) => each.name),
    ).toEqual(["implements", "tests"]);
  });

  test("offers by piece only once the agent named groups", () => {
    expect(arrangementsOf([])).toEqual(["layer", "role"]);
    expect(arrangementsOf([group("a", ["model"])])).toEqual([
      "piece",
      "layer",
      "role",
    ]);
  });
});

describe("groupLinks", () => {
  test("joins groups by the uses between their components", () => {
    const groups = [
      { id: "a", name: "a", gist: "", ids: ["x", "y"] },
      { id: "b", name: "b", gist: "", ids: ["z"] },
    ];
    const links = groupLinks(groups, [
      { from: "x", to: "y" },
      { from: "x", to: "z" },
      { from: "y", to: "z" },
    ]);
    expect(links.get("a")?.uses.map((each) => each.id)).toEqual(["b"]);
    expect(links.get("a")?.usedBy).toEqual([]);
    expect(links.get("b")?.usedBy.map((each) => each.id)).toEqual(["a"]);
  });
});
// ~/~ end
