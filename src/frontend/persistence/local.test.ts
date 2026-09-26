// ~/~ begin <<docs/architecture/frontend/index.md#frontend-persistence-local-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { localRepository } from "./local";

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

const Counter = z.object({ count: z.number() });
const repository = localRepository("test.counter", Counter, { count: 0 });

describe("load", () => {
  test("round-trips a document through save", () => {
    // arrange
    repository.save({ count: 3 });

    // act
    // assert
    expect(repository.load()).toEqual({ count: 3 });
  });

  test("loads the empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
  });

  test("loads the empty document when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("test.counter", "not json");

    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
  });

  test("loads the empty document when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("test.counter", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
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
    expect(() => repository.save({ count: 1 })).not.toThrow();
  });
});
// ~/~ end
