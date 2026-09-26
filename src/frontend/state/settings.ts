// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[init]
import { useCallback, useLayoutEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  type DiffMode,
  Settings,
  type TextSize,
} from "../model/settings";

const STORAGE_KEY = "diffy.settings.v1";

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

  return { settings, setTextSize, setDiffMode };
}
// ~/~ end
