// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-persistence-settings-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { Settings } from "../model/settings";
import { settingsRepository } from "./settings";

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

describe("settingsRepository", () => {
  test("round-trips settings through save", () => {
    // arrange
    const settings: Settings = {
      display: { textSize: "large", diffMode: "line" },
    };

    // act
    settingsRepository.save(settings);

    // assert
    expect(settingsRepository.load()).toEqual(settings);
  });

  test("loads the defaults when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(settingsRepository.load()).toEqual({
      display: { textSize: "standard", diffMode: "structural" },
    });
  });

  test("keeps a text size saved before diff modes existed", () => {
    // arrange
    localStorage.setItem(
      "diffy.settings.v1",
      JSON.stringify({ display: { textSize: "large" } }),
    );

    // act
    // assert
    expect(settingsRepository.load()).toEqual({
      display: { textSize: "large", diffMode: "structural" },
    });
  });
});
// ~/~ end
