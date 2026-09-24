// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { Settings } from "./settings";
import { load, save } from "./settings";

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
  test("round-trips settings through save", () => {
    // arrange
    const settings: Settings = { display: { textSize: "large" } };

    // act
    save(settings);

    // assert
    expect(load()).toEqual(settings);
  });

  test("loads the defaults when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(load()).toEqual({ display: { textSize: "standard" } });
  });

  test("loads the defaults when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("diffy.settings.v1", "not json");

    // act
    // assert
    expect(load()).toEqual({ display: { textSize: "standard" } });
  });

  test("loads the defaults when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("diffy.settings.v1", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(load()).toEqual({ display: { textSize: "standard" } });
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
    expect(() => save({ display: { textSize: "standard" } })).not.toThrow();
  });
});
// ~/~ end
