// ~/~ begin <<docs/architecture/frontend.md#frontend-state-session-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionDocument } from "./review";
import { load, save } from "./session";

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

describe("load", () => {
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
    };

    // act
    save(document);

    // assert
    expect(load()).toEqual(document);
  });

  test("loads an empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", "not json");

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });
});

describe("save", () => {
  test("does not throw when the store throws", () => {
    // arrange
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;

    // act
    // assert
    expect(() => save({ marks: [], comments: [] })).not.toThrow();
  });
});
// ~/~ end
