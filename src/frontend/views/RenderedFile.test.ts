// ~/~ begin <<docs/architecture/frontend/rendered-files.md#frontend-view-rendered-file-test>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import { renderingOf } from "./RenderedFile";

function file(path: string, blobs: Partial<FileDiff> = {}): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch: "",
    structural: { kind: "unavailable", reason: "test" },
    ...blobs,
  } as FileDiff;
}

describe("renderingOf", () => {
  test("shows images, SVG among them, as images", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("logo.PNG"))).toBe("image");
    expect(renderingOf(file("icons/arrow.svg"))).toBe("image");
  });

  test("shows Markdown rendered", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("docs/README.md"))).toBe("markdown");
  });

  test("offers nothing for other files, or for a side with no blob", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("src/app.ts"))).toBeNull();
    expect(renderingOf(file("md"))).toBeNull();
    expect(
      renderingOf(file("logo.png", { oldBlob: null, newBlob: null })),
    ).toBeNull();
  });
});
// ~/~ end
