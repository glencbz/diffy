// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-persistence-settings-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import type { Settings } from "../model/settings";
import { memoryStorage } from "./memoryStorage";
import { settingsRepository } from "./settings";

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

describe("settingsRepository", () => {
  test("round-trips settings through save", () => {
    // arrange
    const settings: Settings = {
      display: {
        textSize: "large",
        diffMode: "line",
        diffLayout: "split",
        wordMarkLimit: 0.9,
        guideNotes: "margin",
      },
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
      display: {
        textSize: "standard",
        diffMode: "structural",
        diffLayout: "unified",
        wordMarkLimit: 0.7,
        guideNotes: "inline",
      },
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
      display: {
        textSize: "large",
        diffMode: "structural",
        diffLayout: "unified",
        wordMarkLimit: 0.7,
        guideNotes: "inline",
      },
    });
  });

  test("keeps a diff mode saved before layouts existed", () => {
    // arrange
    localStorage.setItem(
      "diffy.settings.v1",
      JSON.stringify({ display: { textSize: "large", diffMode: "line" } }),
    );

    // act
    // assert
    expect(settingsRepository.load()).toEqual({
      display: {
        textSize: "large",
        diffMode: "line",
        diffLayout: "unified",
        wordMarkLimit: 0.7,
        guideNotes: "inline",
      },
    });
  });
});
// ~/~ end
