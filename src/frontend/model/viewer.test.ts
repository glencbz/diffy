// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-model-viewer-test>>[init]
import { describe, expect, test } from "bun:test";
import type { Capture } from "./evidence";
import type { Anchor, RowComment } from "./review";
import type { Run } from "./runs";
import {
  anchorOn,
  boxBetween,
  followCapture,
  followItem,
  type Item,
  modesFor,
  notesOn,
  shownAt,
  stepItem,
} from "./viewer";

const PNG = `${"a".repeat(64)}.png` as const;

function run(id: string): Run {
  return {
    series: "local:r",
    version: "1",
    commitId: "c1",
    id,
    name: id,
    state: [],
    about: "",
    before: null,
    after: { steps: [], stopped: null },
    recordedAt: "2026-10-25T00:00:00Z",
  };
}

function capture(id: string, shows: string[], more: Partial<Capture> = {}) {
  return {
    series: "local:r",
    version: "1",
    commitId: "c1",
    id,
    name: id,
    state: [],
    about: "",
    media: "image",
    before: PNG,
    after: PNG,
    shows: shows.map((component) => ({ component, about: "" })),
    attachedAt: "2026-10-24T00:00:00Z",
    ...more,
  } satisfies Capture;
}

describe("following the reading", () => {
  const captures = [
    capture("home", ["header"]),
    capture("settings", ["switch"]),
  ];

  test("keeps the pick while it shows the component being read", () => {
    // act
    const shown = followCapture(
      [...captures, capture("both", ["switch"])],
      { id: "both", reading: null },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("both");
  });

  test("moves to a capture that shows what is read on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "header" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("holds a pick until the reader reads on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "switch" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("home");
  });

  test("keeps the pick when nothing shows what is read", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "settings", reading: null },
      "theme-store",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("starts on the first capture", () => {
    // act
    const shown = followCapture(captures, null, null);

    // assert
    expect(shown?.id).toBe("home");
  });
});

describe("the viewer's choices", () => {
  test("steps round the commit's captures and runs", () => {
    // arrange
    const items: Item[] = [
      { kind: "capture", capture: capture("a", []) },
      { kind: "run", run: run("b") },
    ];

    // act
    const back = stepItem(items, "capture:a", -1);

    // assert
    expect(back).toBe("run:b");
  });

  test("a picked run holds until the reader reads on to a capture", () => {
    // arrange
    const captures = [capture("settings", ["switch"])];
    const runs = [run("switching")];
    const picked = { id: "run:switching", reading: "header" };

    // act
    const held = followItem(captures, runs, picked, "header");
    const moved = followItem(captures, runs, picked, "switch");

    // assert
    expect(held?.kind).toBe("run");
    expect(moved?.kind).toBe("capture");
  });

  test("only lays a picture over its other side", () => {
    // act
    const modes = [
      modesFor(capture("both", [])),
      modesFor(capture("new", [], { before: null })),
      modesFor(capture("clip", [], { media: "video" })),
    ];

    // assert
    expect(modes.map((each) => each.length)).toEqual([4, 1, 1]);
  });

  test("a clip shows a component only within its span", () => {
    // arrange
    const clip = capture("clip", [], {
      media: "video",
      shows: [
        { component: "switch", at: [1, 2], about: "" },
        { component: "header", about: "" },
      ],
    });

    // act
    const early = shownAt(clip, 0.5).map((each) => each.component);

    // assert
    expect(early).toEqual(["header"]);
  });
});
describe("boxBetween", () => {
  test("draws the same box whichever corner the drag starts from", () => {
    // act
    const down = boxBetween([0.1, 0.2], [0.4, 0.6]);
    const up = boxBetween([0.4, 0.6], [0.1, 0.2]);

    // assert
    expect(down).toEqual(up);
    expect(down?.map((each) => Number(each.toFixed(3)))).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });

  test("keeps a drag past the edge on the picture", () => {
    // act
    const box = boxBetween([0.5, 0.5], [1.4, -0.2]);

    // assert
    expect(box).toEqual([0.5, 0, 0.5, 0.5]);
  });

  test("reads a drag too small to see as a click on the whole picture", () => {
    // act
    const box = boxBetween([0.5, 0.5], [0.505, 0.502]);

    // assert
    expect(box).toBeNull();
  });
});

describe("notesOn", () => {
  const comment = (id: string, anchor: Anchor): RowComment => ({
    id,
    reviewKey: "change:a",
    commitId: "c1",
    body: "",
    resolved: false,
    createdAt: "2026-10-26T00:00:00Z",
    author: "reader",
    replies: [],
    stale: false,
    numberedOn: null,
    ...anchor,
  });
  const comments = [
    comment("on-capture", {
      kind: "capture",
      capture: "settings",
      side: "after",
      box: null,
      at: null,
    }),
    comment("on-step", {
      kind: "step",
      run: "checkout",
      step: 1,
      side: "after",
      box: null,
      request: null,
      console: null,
    }),
    comment("on-request", {
      kind: "step",
      run: "checkout",
      step: 1,
      side: "after",
      box: null,
      request: { method: "GET", url: "/api/cart" },
      console: null,
    }),
    comment("other-step", {
      kind: "step",
      run: "checkout",
      step: 0,
      side: "after",
      box: null,
      request: null,
      console: null,
    }),
    comment("on-line", { kind: "line", path: "a.ts", side: "after", line: 1 }),
  ];

  test("finds a capture's threads", () => {
    // act
    const found = notesOn(comments, { kind: "capture", capture: "settings" });

    // assert
    expect(found.map((each) => each.id)).toEqual(["on-capture"]);
  });

  test("finds one step's threads and leaves its requests to Network", () => {
    // act
    const found = notesOn(comments, { kind: "step", run: "checkout", step: 1 });

    // assert
    expect(found.map((each) => each.id)).toEqual(["on-step"]);
  });
});

describe("anchorOn", () => {
  test("anchors a spot on a step to the whole step, not a request", () => {
    // act
    const anchor = anchorOn(
      { kind: "step", run: "checkout", step: 2 },
      { side: "before", box: [0, 0, 1, 1], at: null },
    );

    // assert
    expect(anchor).toEqual({
      kind: "step",
      run: "checkout",
      step: 2,
      side: "before",
      box: [0, 0, 1, 1],
      request: null,
      console: null,
    });
  });
});
// ~/~ end
