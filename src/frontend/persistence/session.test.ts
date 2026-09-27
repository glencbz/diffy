// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-persistence-session-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionDocument } from "../model/review";
import { sessionRepository } from "./session";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

describe("sessionRepository", () => {
  test("round-trips a document through save", () => {
    // arrange
    const document: SessionDocument = {
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
    sessionRepository.save(document);

    // assert
    expect(sessionRepository.load()).toEqual(document);
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
    expect(sessionRepository.load()).toEqual({
      marks: [mark],
      comments: [],
      viewed: [],
    });
  });

  test("loads an empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(sessionRepository.load()).toEqual({
      marks: [],
      comments: [],
      viewed: [],
    });
  });
});
// ~/~ end
