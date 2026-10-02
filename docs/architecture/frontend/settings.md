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

`Settings` is stored the way the [review document](review.md#storage) is,
through a [repository](index.md#local-storage) of its own. A Zod schema
parses whatever `localStorage` holds. Anything that fails to parse falls back
to the defaults, whether it is an older shape, a hand-edited
blob, or nothing at all. `localStorage` is per browser, so a phone keeps its
own size and a laptop keeps the default, which is the split the setting
exists for.

A diff is drawn [structurally or line by line](diff.md#diff-view), and the
reader picks which one files start in. Structural is the default because it
is the one that hides layout noise. The choice is only a starting point,
since each file has its own switch.

The reader also picks whether a diff is laid out in one column or
[side by side](diff.md#side-by-side). Unlike the view, the layout is not a
starting point with a switch on every file, since a reader who wants two
columns wants them for every file at once. It is a setting of the device
for the same reason the text size is: a laptop has room for two columns and
a phone has less, so a reader may want them on one and not the other. The
setting is obeyed at every width and in both views.

A structural line marks the words difftastic says changed, until so much of
it changed that the marks cover nearly everything and say less than the
line's own tint. Where that point sits is a matter of taste, so the reader
picks it: the share of a line's words that can change before
[its marks go](diff.md#changed-words). The choices are a few fixed steps,
because a reader can tell 50% from 90% on screen but not 70% from 75%.

`diffMode`, `diffLayout`, and `wordMarkLimit` each parse with a default of
their own. Settings saved before a choice existed do not have it, and without the
default they would fail to parse and reset the reader's text size along
with it.

What a setting can be and what it starts as are the settings'
[model](index.md#model), apart from the state that holds them and the
repository that stores them. The diff view needs the vocabulary and the
default, and neither needs storage or React. With both in `state/`, a view
could not name a diff mode without reaching into the layer that owns the
settings hook. Each default is written
once, in `DEFAULT_SETTINGS`, and the schema, the fallback, and the context
all read it from there. The display is a schema of its own, so the diff
view can take the display as one prop without the settings around it.

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

const DEFAULT_DISPLAY = {
  textSize: "standard",
  diffMode: "structural",
  diffLayout: "unified",
  wordMarkLimit: 0.7,
} as const;

export const Display = z.object({
  textSize: TextSize,
  diffMode: DiffMode.default(DEFAULT_DISPLAY.diffMode),
  diffLayout: DiffLayout.default(DEFAULT_DISPLAY.diffLayout),
  wordMarkLimit: WordMarkLimit.default(DEFAULT_DISPLAY.wordMarkLimit),
});
export type Display = z.infer<typeof Display>;

export const Settings = z.object({ display: Display });
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
      },
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
import { createContext, useCallback, useContext, useLayoutEffect } from "react";
import type {
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
}

export function useSettings(): SettingsHandle {
  const [settings, update] = useStored(settingsRepository);

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

  return {
    settings,
    setTextSize,
    setDiffMode,
    setDiffLayout,
    setWordMarkLimit,
  };
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

## Sharing the settings

The settings reach every screen through one context, `SettingsContext`,
which `App` fills with the handle `useSettings` returns. A diff sits several
screens and controllers below `App`, and none of the layers above its
controller has any use for the default view, the layout, or the word mark
limit, so threading them down as props would make every one of them carry
the settings. The settings screen reads the same context, so a choice there
reaches every diff at once.

The context holds the whole handle rather than one value per setting, so a
new setting reaches every reader without a provider of its own in `App`. It
is state like any other, so it sits beside `useSettings`, and like any other
state a controller reads it and hands a view what the view draws. A diff's
controller passes the display on, and the diff view takes it as a prop. The
context has no default, since a screen drawn outside `App` has no settings
to draw, and reading it there throws rather than quietly falling back.

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

One `<fieldset>` per choice. A radio group is the right control for a
size, a diff view, a layout, and a word mark limit alike: the choices are mutually exclusive, there are few
enough to show all at once, and a native `<input type="radio">` gets
keyboard and screen reader behaviour for free that a row of buttons would
have to reimplement.

The captions are drawn at the current size, not each at the size it names.
The whole page resizes the moment a radio is picked, which is a better
preview than four captions. Drawing each caption at its own size would also
repeat every pixel value in a second set of rules.

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

The screen around the form is the [mode tabs](shell.md#mode-tabs) and the
form, filled from [`SettingsContext`](#sharing-the-settings). It draws no
review strip, since nothing on it is reviewed.

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
