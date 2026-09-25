// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-state-settings>>[init]
import { useCallback, useLayoutEffect } from "react";
import type {
  DiffLayout,
  DiffMode,
  Settings,
  TextSize,
} from "../model/settings";
import { settingsRepository } from "../persistence/settings";
import { useStored } from "./stored";

export interface SettingsHandle {
  settings: Settings;
  setTextSize: (textSize: TextSize) => void;
  setDiffMode: (diffMode: DiffMode) => void;
  setDiffLayout: (diffLayout: DiffLayout) => void;
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
  const setDiffLayout = useCallback(
    (diffLayout: DiffLayout) => setDisplay({ diffLayout }),
    [setDisplay],
  );

  return { settings, setTextSize, setDiffMode, setDiffLayout };
}
// ~/~ end
