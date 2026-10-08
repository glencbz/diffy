// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[init]
import { createContext, useCallback, useContext, useLayoutEffect } from "react";
import type {
  DiffLayout,
  DiffMode,
  Display,
  GuideNotes,
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
  setGuideNotes: (guideNotes: GuideNotes) => void;
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
  const setGuideNotes = useCallback(
    (guideNotes: GuideNotes) => setDisplay({ guideNotes }),
    [setDisplay],
  );

  return {
    settings,
    setTextSize,
    setDiffMode,
    setDiffLayout,
    setWordMarkLimit,
    setGuideNotes,
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[1]

export const SettingsContext = createContext<SettingsHandle | null>(null);

export function useSettingsContext(): SettingsHandle {
  const settings = useContext(SettingsContext);
  if (settings === null)
    throw new Error("no SettingsContext above this screen");
  return settings;
}
// ~/~ end
