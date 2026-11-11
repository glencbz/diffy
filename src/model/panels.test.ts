// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-model-panels-test>>[init]
import { describe, expect, test } from "bun:test";
import {
  closePanel,
  DEFAULT_LAYOUTS,
  findLeaf,
  isWhole,
  LAYOUTS,
  type Layout,
  LayoutsDocument,
  leafWith,
  missing,
  movePanel,
  panelsIn,
  treeOf,
} from "./panels";

const stacked = LAYOUTS[0] as Layout;

describe("layouts", () => {
  test("every layout holds each panel once", () => {
    // arrange
    // act
    const whole = LAYOUTS.map((layout) => isWhole(layout.tree));
    const closed = LAYOUTS.map((layout) => missing(layout.tree));

    // assert
    expect(whole.every(Boolean)).toBe(true);
    expect(closed.every((each) => each.length === 0)).toBe(true);
  });

  test("closing a leaf's only panel lets its sibling take the split", () => {
    // arrange
    // act
    const tree = closePanel(closePanel(stacked.tree, "components"), "viewer");

    // assert
    expect(missing(tree)).toEqual(["components", "viewer"]);
    expect(findLeaf(tree, "stacked/rail")).toBeNull();
    expect(tree.kind === "split" && tree.children[1]?.kind).toBe("leaf");
  });

  test("the code never closes", () => {
    // arrange
    // act
    const tree = closePanel(stacked.tree, "code");

    // assert
    expect(tree).toBe(stacked.tree);
  });

  test("moving a panel takes it out of its leaf and puts it in front", () => {
    // arrange
    // act
    const tree = movePanel(stacked.tree, "threads", "stacked/rail");

    // assert
    expect(findLeaf(tree, "stacked/drawer")?.tabs).toEqual([
      "commits",
      "network",
      "console",
    ]);
    expect(findLeaf(tree, "stacked/rail")).toMatchObject({
      tabs: ["components", "threads"],
      active: "threads",
    });
  });

  test("a closed panel moves back in", () => {
    // arrange
    const closed = closePanel(stacked.tree, "threads");

    // act
    const tree = movePanel(closed, "threads", "stacked/code");

    // assert
    expect(leafWith(tree, "threads")?.id).toBe("stacked/code");
    expect(isWhole(tree)).toBe(true);
  });

  test("a leaf's only panel cannot move into itself", () => {
    // arrange
    // act
    const tree = movePanel(stacked.tree, "components", "stacked/rail");

    // assert
    expect(panelsIn(tree)).toEqual(panelsIn(stacked.tree));
  });

  test("an edit that lost the code gives way to the layout", () => {
    // arrange
    const broken = LayoutsDocument.parse({
      ...DEFAULT_LAYOUTS,
      edited: {
        stacked: {
          kind: "leaf",
          id: "x",
          tabs: ["commits"],
          active: "commits",
        },
      },
    });

    // act
    const tree = treeOf(broken, stacked);

    // assert
    expect(tree).toBe(stacked.tree);
  });
});
// ~/~ end
