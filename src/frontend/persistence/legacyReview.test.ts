// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-legacy-review-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import { EMPTY_REVIEW } from "../model/review";
import { clearLegacyReview, legacyReview } from "./legacyReview";
import { memoryStorage } from "./memoryStorage";

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

const mark = {
  reviewKey: "change:a",
  fromCommitId: "a1",
  toCommitId: "a2",
  seenAt: "2026-09-14T09:00:00.000Z",
};
const head = "b".repeat(40);

describe("legacyReview", () => {
  test("reads nothing when the browser kept nothing", () => {
    // arrange
    // act
    // assert
    expect(legacyReview("now")).toBeNull();
  });

  test("reads the session and each pull request's head into one document", () => {
    // arrange
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [mark], comments: [] }),
    );
    localStorage.setItem(
      "diffy.last-reviewed.v1:o/r#7",
      JSON.stringify({ head }),
    );

    // act
    const document = legacyReview("now");

    // assert
    expect(document).toEqual({
      ...EMPTY_REVIEW,
      marks: [mark],
      reviewed: [{ series: "pull:o/r#7", version: head, reviewedAt: "now" }],
    });
  });

  test("keeps the comments of a session saved before comments had kinds", () => {
    // arrange
    const comment = {
      id: "c1",
      reviewKey: "change:a",
      path: "f.ts",
      line: 3,
      commitId: "a2",
      body: "written before kinds",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
    };
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [], comments: [comment] }),
    );

    // act
    // assert
    expect(legacyReview("now")?.comments).toEqual([
      { ...comment, kind: "line", side: "after", author: "reader" },
    ]);
  });

  test("skips a pull request's head that does not parse", () => {
    // arrange
    localStorage.setItem("diffy.last-reviewed.v1:o/r#9", '{"head":"abc"}');

    // act
    // assert
    expect(legacyReview("now")).toBeNull();
  });
});

describe("clearLegacyReview", () => {
  test("forgets the review keys and leaves the settings", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", "{}");
    localStorage.setItem("diffy.last-reviewed.v1:o/r#7", "{}");
    localStorage.setItem("diffy.settings.v1", "{}");

    // act
    clearLegacyReview();

    // assert
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("diffy.settings.v1")).toBe("{}");
  });
});
// ~/~ end
