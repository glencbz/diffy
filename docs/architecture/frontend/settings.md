# Settings

Settings record how a reader wants to look at a diff. They belong to the
device, not to any repository, so they stay in the browser's `localStorage`:
a phone and a laptop keep their own.

## Display

Text sizes are anchored on GitHub, the other place these diffs get read:
Standard is its 12px diff code, Large its 14px body text. GitHub keeps one
size on a phone, so Standard is the default everywhere.

The diff view setting is only where each file starts, since every file has
its own switch. Layout (one column or [side by side](diff.md#side-by-side))
applies to every file at once and is per device, since a phone has less room.
The word mark limit is the share of a line's words that can change before
[its marks go](diff.md#changed-words), offered in steps a reader can tell
apart. Whether a [component map](components.md#the-switch) is laid over
a series is set from the switch in the comparison bar, and kept here so it
holds on every series.

```ts
//| id: frontend-model-settings
//| file: src/frontend/model/settings.ts
import * as z from "zod";

export const TextSize = z.enum(["small", "standard", "large", "larger"]);
export type TextSize = z.infer<typeof TextSize>;

export const DiffMode = z.enum(["structural", "line"]);
export type DiffMode = z.infer<typeof DiffMode>;

export const DiffLayout = z.enum(["unified", "split"]);
export type DiffLayout = z.infer<typeof DiffLayout>;

export const WordMarkLimit = z.union([
  z.literal(0.5),
  z.literal(0.7),
  z.literal(0.9),
]);
export type WordMarkLimit = z.infer<typeof WordMarkLimit>;

/** Whether a series with a [component map](components.md) is read with it
 *  laid over the diff. */
export const ComponentsShown = z.enum(["shown", "hidden"]);
export type ComponentsShown = z.infer<typeof ComponentsShown>;

const DEFAULT_DISPLAY = {
  textSize: "standard",
  diffMode: "structural",
  diffLayout: "unified",
  wordMarkLimit: 0.7,
  components: "shown",
} as const;

// Every field added after the first needs a default, or older saved
// settings fail to parse and reset the reader's text size with them.
export const Display = z.object({
  textSize: TextSize,
  diffMode: DiffMode.default(DEFAULT_DISPLAY.diffMode),
  diffLayout: DiffLayout.default(DEFAULT_DISPLAY.diffLayout),
  wordMarkLimit: WordMarkLimit.default(DEFAULT_DISPLAY.wordMarkLimit),
  components: ComponentsShown.default(DEFAULT_DISPLAY.components),
});
export type Display = z.infer<typeof Display>;

export const Settings = z.object({ display: Display });
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = { display: DEFAULT_DISPLAY };
```

```ts
//| id: frontend-persistence-settings
//| file: src/frontend/persistence/settings.ts
import { DEFAULT_SETTINGS, Settings } from "../model/settings";
import { localRepository } from "./local";

export const settingsRepository = localRepository<Settings>(
  "diffy.settings.v1",
  Settings,
  DEFAULT_SETTINGS,
);
```

```ts
//| id: frontend-persistence-settings-test
//| file: src/frontend/persistence/settings.test.ts
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
        components: "shown",
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
        components: "shown",
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
        components: "shown",
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
        components: "shown",
      },
    });
  });
});
```

```ts
//| id: frontend-state-settings
//| file: src/frontend/state/settings.ts
import { createContext, useCallback, useContext, useLayoutEffect } from "react";
import type {
  ComponentsShown,
  DiffLayout,
  DiffMode,
  Display,
  Settings,
  TextSize,
  WordMarkLimit,
} from "../model/settings";
import { settingsRepository } from "../persistence/settings";
import { useStored } from "./stored";

/** The reader's settings and one setter for each choice in them. */
export interface SettingsHandle {
  settings: Settings;
  setTextSize: (textSize: TextSize) => void;
  setDiffMode: (diffMode: DiffMode) => void;
  setDiffLayout: (diffLayout: DiffLayout) => void;
  setWordMarkLimit: (wordMarkLimit: WordMarkLimit) => void;
  setComponents: (components: ComponentsShown) => void;
}

export function useSettings(): SettingsHandle {
  const [settings, update] = useStored(settingsRepository);

  // A plain effect runs after paint, so every load would flash at the
  // standard size first.
  useLayoutEffect(() => {
    document.documentElement.dataset.textSize = settings.display.textSize;
  }, [settings.display.textSize]);

  const setDisplay = useCallback(
    (change: Partial<Display>) => {
      update((current) => ({
        ...current,
        display: { ...current.display, ...change },
      }));
    },
    [update],
  );
  const setTextSize = useCallback(
    (textSize: TextSize) => setDisplay({ textSize }),
    [setDisplay],
  );
  const setDiffMode = useCallback(
    (diffMode: DiffMode) => setDisplay({ diffMode }),
    [setDisplay],
  );
  const setDiffLayout = useCallback(
    (diffLayout: DiffLayout) => setDisplay({ diffLayout }),
    [setDisplay],
  );
  const setWordMarkLimit = useCallback(
    (wordMarkLimit: WordMarkLimit) => setDisplay({ wordMarkLimit }),
    [setDisplay],
  );

  const setComponents = useCallback(
    (components: ComponentsShown) => setDisplay({ components }),
    [setDisplay],
  );

  return {
    settings,
    setTextSize,
    setDiffMode,
    setDiffLayout,
    setWordMarkLimit,
    setComponents,
  };
}
```

Each size rebinds the two text tokens off the attribute `useSettings` writes;
`standard` needs no rule.

```css
/*| id: design-text-size
@layer settings {
  :root[data-text-size="small"] {
    --text-size: 11px;
    --text-size-small: 10px;
  }

  :root[data-text-size="large"] {
    --text-size: 14px;
    --text-size-small: 12px;
  }

  :root[data-text-size="larger"] {
    --text-size: 16px;
    --text-size-small: 14px;
  }
}
```

## Sharing the settings

`App` fills `SettingsContext` with the `useSettings` handle, so a diff
several layers down reads it without every layer above passing it on. It
holds the whole handle, so a new setting needs no new provider, and it has
no default: reading it outside `App` throws.

```ts
//| id: frontend-state-settings

export const SettingsContext = createContext<SettingsHandle | null>(null);

export function useSettingsContext(): SettingsHandle {
  const settings = useContext(SettingsContext);
  if (settings === null)
    throw new Error("no SettingsContext above this screen");
  return settings;
}
```

## Settings screen

One radio `<fieldset>` per choice. Captions draw at the current size; the
page resizing as soon as a radio is picked is the preview.

```tsx
//| id: frontend-view-settings-form
//| file: src/frontend/views/SettingsForm.tsx
import type {
  DiffLayout,
  DiffMode,
  Settings,
  TextSize,
  WordMarkLimit,
} from "../model/settings";

const TEXT_SIZES: { value: TextSize; caption: string }[] = [
  { value: "small", caption: "Small" },
  { value: "standard", caption: "Standard" },
  { value: "large", caption: "Large" },
  { value: "larger", caption: "Larger" },
];

const DIFF_MODES: { value: DiffMode; caption: string }[] = [
  { value: "structural", caption: "Structural, with difftastic" },
  { value: "line", caption: "Line by line" },
];

const DIFF_LAYOUTS: { value: DiffLayout; caption: string }[] = [
  { value: "unified", caption: "One column" },
  { value: "split", caption: "Side by side" },
];

const WORD_MARK_LIMITS: { value: WordMarkLimit; caption: string }[] = [
  { value: 0.5, caption: "Until half of a line changed" },
  { value: 0.7, caption: "Until 70% of a line changed" },
  { value: 0.9, caption: "Until 90% of a line changed" },
];

export function SettingsForm({
  settings,
  onSetTextSize,
  onSetDiffMode,
  onSetDiffLayout,
  onSetWordMarkLimit,
}: {
  settings: Settings;
  onSetTextSize: (textSize: TextSize) => void;
  onSetDiffMode: (diffMode: DiffMode) => void;
  onSetDiffLayout: (diffLayout: DiffLayout) => void;
  onSetWordMarkLimit: (wordMarkLimit: WordMarkLimit) => void;
}) {
  return (
    <div className="settings">
      <fieldset className="settings__section">
        <legend>Text size</legend>
        {TEXT_SIZES.map(({ value, caption }) => (
          <label key={value} className="settings__option">
            <input
              type="radio"
              name="text-size"
              value={value}
              checked={settings.display.textSize === value}
              onChange={() => onSetTextSize(value)}
            />
            {caption}
          </label>
        ))}
      </fieldset>
      <fieldset className="settings__section">
        <legend>Diffs start as</legend>
        {DIFF_MODES.map(({ value, caption }) => (
          <label key={value} className="settings__option">
            <input
              type="radio"
              name="diff-mode"
              value={value}
              checked={settings.display.diffMode === value}
              onChange={() => onSetDiffMode(value)}
            />
            {caption}
          </label>
        ))}
      </fieldset>
      <fieldset className="settings__section">
        <legend>Diffs are laid out</legend>
        {DIFF_LAYOUTS.map(({ value, caption }) => (
          <label key={value} className="settings__option">
            <input
              type="radio"
              name="diff-layout"
              value={value}
              checked={settings.display.diffLayout === value}
              onChange={() => onSetDiffLayout(value)}
            />
            {caption}
          </label>
        ))}
      </fieldset>
      <fieldset className="settings__section">
        <legend>Structural diffs mark changed words</legend>
        {WORD_MARK_LIMITS.map(({ value, caption }) => (
          <label key={value} className="settings__option">
            <input
              type="radio"
              name="word-mark-limit"
              value={value}
              checked={settings.display.wordMarkLimit === value}
              onChange={() => onSetWordMarkLimit(value)}
            />
            {caption}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
```

```css
/*| id: design-settings
@layer components {
  .settings {
    padding: var(--space-6);
  }

  .settings__section {
    margin: 0;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .settings__section + .settings__section {
    margin-top: var(--space-5);
  }

  .settings__section legend {
    padding: 0 var(--space-3);
    color: var(--text-muted);
  }

  .settings__option {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-3);
    cursor: pointer;
  }

  .settings__option + .settings__option {
    border-top: 1px solid var(--border-subtle);
  }
}
```

```tsx
//| id: frontend-screen-settings
//| file: src/frontend/screens/SettingsScreen.tsx
import { type Place, tabPlace } from "../model/place";
import { useSettingsContext } from "../state/settings";
import { ModeTabs } from "../views/ModeTabs";
import { SettingsForm } from "../views/SettingsForm";

export function SettingsScreen({ onGo }: { onGo: (place: Place) => void }) {
  const settings = useSettingsContext();

  return (
    <div className="app">
      <ModeTabs
        mode="settings"
        onSelect={(mode) => {
          if (mode !== "settings") onGo(tabPlace(mode));
        }}
      />
      <SettingsForm
        settings={settings.settings}
        onSetTextSize={settings.setTextSize}
        onSetDiffMode={settings.setDiffMode}
        onSetDiffLayout={settings.setDiffLayout}
        onSetWordMarkLimit={settings.setWordMarkLimit}
      />
    </div>
  );
}
```
