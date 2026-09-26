# Settings

How the app looks to the reader using it. Review state records what a
reader has looked at. Settings record how they want to look at it, and they
belong to the device rather than to any repository. Display is the only
section so far.

## Display

The text everywhere in the app comes from two tokens, `--text-size` and
`--text-size-small`, set in [Design tokens](tokens.md#metrics). The sizes are
anchored on GitHub.com, the other place a reader reads these diffs. GitHub
draws diff code at 12 pixels, so Standard is 12. Large is 14, GitHub's body
text and the next size up that it uses. Small and Larger continue the steps
on either side.

GitHub keeps the same sizes on a phone and grows only its headings, so
Standard is the default on every screen. A reader who wants more on a phone
picks Large there, and the laptop keeps its own choice.

`Settings` is stored the way the [session](review-tracking.md#session) is,
through a [repository](index.md#local-storage) of its own. A Zod schema
parses whatever `localStorage` holds. Anything that fails to parse falls back
to the defaults, whether it is an older shape, a hand-edited
blob, or nothing at all. `localStorage` is per browser, so a phone keeps its
own size and a laptop keeps the default, which is the split the setting
exists for.

A diff is drawn [structurally or line by line](diff.md#diff-view), and the
reader picks which one files start in. Structural is the default because it
is the one that hides layout noise. The choice is only a starting point,
since each file has its own switch. The reader's choice reaches the diff view
through [`DiffModeDefault`](diff.md#diff-view), a context, since the diffs sit
several screens and controllers below `App` and none of those layers has any
use for it.

`diffMode` parses with a default of its own. Settings saved before the
choice existed have no `diffMode`, and without the default they would fail
to parse and reset the reader's text size along with it.

What a setting can be and what it starts as are the settings'
[model](index.md#model), apart from the state that holds them and the
repository that stores them. The diff view needs the vocabulary and the
default, and neither needs storage or React. With both in `state/`, a view
could not name a diff mode without reaching into the layer that owns the
settings hook. Each default is written
once, in `DEFAULT_SETTINGS`, and the schema, the fallback, and the context
all read it from there.

```ts
//| id: frontend-model-settings
//| file: src/frontend/model/settings.ts
import * as z from "zod";

export const TextSize = z.enum(["small", "standard", "large", "larger"]);
export type TextSize = z.infer<typeof TextSize>;

export const DiffMode = z.enum(["structural", "line"]);
export type DiffMode = z.infer<typeof DiffMode>;

const DEFAULT_DISPLAY = {
  textSize: "standard",
  diffMode: "structural",
} as const;

export const Settings = z.object({
  display: z.object({
    textSize: TextSize,
    diffMode: DiffMode.default(DEFAULT_DISPLAY.diffMode),
  }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = { display: DEFAULT_DISPLAY };
```

`settingsRepository` names the key the settings are kept under, the schema
that reads them, and the defaults to fall back to.

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

The repository's tests cover what the settings schema adds to
[`localRepository`](index.md#local-storage)'s.

```ts
//| id: frontend-persistence-settings-test
//| file: src/frontend/persistence/settings.test.ts
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
```

The size is written to the page in a layout effect, not a plain effect. A
plain effect runs after the browser paints, so a reader who chose a larger
size would see every load flash at the standard size first.

```ts
//| id: frontend-state-settings
//| file: src/frontend/state/settings.ts
import { useCallback, useLayoutEffect } from "react";
import type { DiffMode, Settings, TextSize } from "../model/settings";
import { settingsRepository } from "../persistence/settings";
import { useStored } from "./stored";

export interface SettingsHandle {
  settings: Settings;
  setTextSize: (textSize: TextSize) => void;
  setDiffMode: (diffMode: DiffMode) => void;
}

export function useSettings(): SettingsHandle {
  const [settings, update] = useStored(settingsRepository);

  useLayoutEffect(() => {
    document.documentElement.dataset.textSize = settings.display.textSize;
  }, [settings.display.textSize]);

  const setDisplay = useCallback(
    (change: Partial<Settings["display"]>) => {
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

  return { settings, setTextSize, setDiffMode };
}
```

The pixel values stay in the stylesheet with every other length. Each size
is one rule that rebinds the two tokens, keyed off the data attribute
`useSettings` writes. `"standard"` has no rule, because it is what the tokens
already say. The rules sit in a `settings` layer above `metrics-narrow`, so a
size the reader picked beats any default a breakpoint sets.

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

## Settings screen

One `<fieldset>` per choice. A radio group is the right control for both a
size and a diff view: the choices are mutually exclusive, there are few
enough to show all at once, and a native `<input type="radio">` gets
keyboard and screen reader behaviour for free that a row of buttons would
have to reimplement.

The captions are drawn at the current size, not each at the size it names.
The whole page resizes the moment a radio is picked, which is a better
preview than four captions. Drawing each caption at its own size would also
repeat every pixel value in a second set of rules.

```tsx
//| id: frontend-view-settings-screen
//| file: src/frontend/views/SettingsScreen.tsx
import type { DiffMode, Settings, TextSize } from "../model/settings";

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

export function SettingsScreen({
  settings,
  onSetTextSize,
  onSetDiffMode,
}: {
  settings: Settings;
  onSetTextSize: (textSize: TextSize) => void;
  onSetDiffMode: (diffMode: DiffMode) => void;
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
    </div>
  );
}
```

Tap targets get the whole label rather than the small circle a radio button
draws on its own, which is what makes each one comfortable to hit on a phone.

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
