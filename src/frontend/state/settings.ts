// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[init]
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
// ~/~ end
