// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-review-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { ReviewDocument } from "../model/review";
import { memoryStorage } from "./memoryStorage";
import { reviewRepository } from "./review";

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

describe("reviewRepository", () => {
  test("round-trips a document through save", () => {
    // arrange
    const document: ReviewDocument = {
      marks: [
        {
          reviewKey: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
      viewed: [
        {
          reviewKey: "a",
          path: "f.ts",
          oldBlob: null,
          newBlob: "b1",
          viewedAt: "2026-09-25T09:00:00.000Z",
        },
      ],
    };

    // act
    reviewRepository.save(document);

    // assert
    expect(reviewRepository.load()).toEqual(document);
  });

  test("loads a document saved before viewed marks, with none viewed", () => {
    // arrange
    const mark = {
      reviewKey: "a",
      fromCommitId: "a1",
      toCommitId: "a2",
      seenAt: "2026-09-14T09:00:00.000Z",
    };
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [mark], comments: [] }),
    );

    // act
    // assert
    expect(reviewRepository.load()).toEqual({
      marks: [mark],
      comments: [],
      viewed: [],
    });
  });

  test("keeps the comments of a document saved before comments had kinds", () => {
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
    expect(reviewRepository.load().comments).toEqual([
      { ...comment, kind: "line", side: "after", author: "reader" },
    ]);
  });

  test("loads an empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(reviewRepository.load()).toEqual({
      marks: [],
      comments: [],
      viewed: [],
    });
  });
});
// ~/~ end
