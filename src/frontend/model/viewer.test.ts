// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-model-viewer-test>>[init]
import { describe, expect, test } from "bun:test";
import type { Capture } from "./evidence";
import { followCapture, modesFor, shownAt, stepCapture } from "./viewer";

const PNG = `${"a".repeat(64)}.png` as const;

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
  test("steps round the commit's captures", () => {
    // arrange
    const captures = [capture("a", []), capture("b", [])];

    // act
    const back = stepCapture(captures, "a", -1);

    // assert
    expect(back).toBe("b");
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
// ~/~ end
