// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[init]
import { createContext, useCallback, useLayoutEffect, useState } from "react";
import * as z from "zod";

export const TextSize = z.enum(["small", "standard", "large", "larger"]);
export type TextSize = z.infer<typeof TextSize>;

export const DiffMode = z.enum(["structural", "line"]);
export type DiffMode = z.infer<typeof DiffMode>;

export const DiffLayout = z.enum(["unified", "split"]);
export type DiffLayout = z.infer<typeof DiffLayout>;

export const Settings = z.object({
  display: z.object({
    textSize: TextSize,
    diffMode: DiffMode.default("structural"),
    diffLayout: DiffLayout.default("unified"),
  }),
});
export type Settings = z.infer<typeof Settings>;

const STORAGE_KEY = "diffy.settings.v1";
const DEFAULT_SETTINGS: Settings = {
  display: {
    textSize: "standard",
    diffMode: "structural",
    diffLayout: "unified",
  },
};

/** The view a file's diff starts in until the reader switches that file. */
export const DiffModeDefault = createContext<DiffMode>("structural");

/** Whether a line diff is drawn in one column or two, where there is room. */
export const DiffLayoutSetting = createContext<DiffLayout>("unified");

/** localStorage content is written by a possibly older version of this
 * app, or by hand in devtools; treat it as untrusted input and fall back
 * to the defaults rather than let a bad blob break the app. */
export function load(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_SETTINGS;

  try {
    return Settings.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** setItem throws in Safari private browsing and over quota; there is no
 * error channel from here back to a click handler, and settings that keep
 * working for the tab without persisting beats a page that throws. */
export function save(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // See the doc comment: persistence failure is not worth a UI state.
  }
}

export interface SettingsHandle {
  settings: Settings;
  setTextSize: (textSize: TextSize) => void;
  setDiffMode: (diffMode: DiffMode) => void;
  setDiffLayout: (diffLayout: DiffLayout) => void;
}

export function useSettings(): SettingsHandle {
  const [settings, setSettings] = useState<Settings>(load);

  useLayoutEffect(() => {
    document.documentElement.dataset.textSize = settings.display.textSize;
  }, [settings.display.textSize]);

  const setDisplay = useCallback((change: Partial<Settings["display"]>) => {
    setSettings((current) => {
      const next: Settings = {
        ...current,
        display: { ...current.display, ...change },
      };
      save(next);
      return next;
    });
  }, []);
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

  return { settings, setTextSize, setDiffMode, setDiffLayout };
}
// ~/~ end
