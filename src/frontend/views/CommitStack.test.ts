// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack-test>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import {
  countLines,
  messageBlocks,
  opening,
  splitMessage,
} from "./CommitStack";

describe("opening", () => {
  test("keeps a short first paragraph whole", () => {
    // arrange
    const body = "one\ntwo\n\nthree\nfour";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("one\ntwo");
    expect(rest).toBe(2);
  });

  test("caps a long first paragraph at six lines", () => {
    // arrange
    const body = "1\n2\n3\n4\n5\n6\n7\n8";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("1\n2\n3\n4\n5\n6");
    expect(rest).toBe(2);
  });

  test("takes every line when there is no blank line at all", () => {
    // arrange
    const body = "1\n2\n3";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("1\n2\n3");
    expect(rest).toBe(0);
  });

  test("counts only the lines with text in what it leaves out", () => {
    // arrange
    const body = "a\n\nb\nc\nd";

    // act
    const { rest } = opening(body);

    // assert
    expect(rest).toBe(3);
  });

  test("leaves nothing to read for a commit with only a subject", () => {
    // arrange
    const body = "";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("");
    expect(rest).toBe(0);
  });
});

describe("messageBlocks", () => {
  test("collapses a paragraph's line breaks to single spaces", () => {
    // arrange
    const body = "this wraps\nacross two lines";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      { kind: "paragraph", text: "this wraps across two lines" },
    ]);
  });

  test("folds a wrapped continuation line into the bullet above it", () => {
    // arrange
    const body = "- first item\n  still the first item\n- second item";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      {
        kind: "bullets",
        items: ["first item still the first item", "second item"],
      },
    ]);
  });

  test("keeps an indented block verbatim", () => {
    // arrange
    const body = "  $ some command\n  output line";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      { kind: "pre", text: "  $ some command\n  output line" },
    ]);
  });
});

describe("splitMessage", () => {
  test("peels a co-authored-by trailer off the end of the body", () => {
    // arrange
    const description =
      "subject line\n\nbody line one\n\nCo-authored-by: Ada <ada@example.com>";

    // act
    const { subject, body, trailers } = splitMessage(description);

    // assert
    expect(subject).toBe("subject line");
    expect(body).toBe("body line one");
    expect(trailers).toBe("Co-authored-by: Ada <ada@example.com>");
  });
});

describe("countLines", () => {
  test("ignores the +++/--- file header lines", () => {
    // arrange
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "--- a/a.ts\n+++ b/a.ts\n+added line\n-removed line\n context",
        structural: { kind: "unavailable", reason: "not diffed" },
      },
    ];

    // act
    const { added, removed } = countLines(files);

    // assert
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });
});
// ~/~ end
