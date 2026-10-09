// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components-test>>[init]
import { describe, expect, test } from "bun:test";
import {
  type Component,
  type ComponentMap,
  componentsTo,
  withComponents,
} from "./components";

function component(id: string, commitId = "c1"): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: [{ path: "a.ts", side: "after", start: 1, about: "" }],
  };
}

function map(version: string, ids: string[]): ComponentMap {
  return {
    series: "local:r",
    version,
    author: "claude",
    writtenAt: "t",
    components: ids.map((id) => component(id)),
  };
}

describe("component maps", () => {
  test("keeps one map to each version, the newest written", () => {
    // arrange
    const maps = withComponents([map("1", ["a"])], map("2", ["a"]));

    // act
    const rewritten = withComponents(maps, map("1", ["b"]));

    // assert
    expect(rewritten).toHaveLength(2);
    expect(componentsTo(rewritten, "local:r", "1")?.components[0]?.id).toBe(
      "b",
    );
    expect(componentsTo(rewritten, "local:r", "3")).toBeUndefined();
  });
});
// ~/~ end
