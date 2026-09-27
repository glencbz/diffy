// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-persistence-settings>>[init]
import { DEFAULT_SETTINGS, Settings } from "../model/settings";
import { localRepository } from "./local";

export const settingsRepository = localRepository<Settings>(
  "diffy.settings.v1",
  Settings,
  DEFAULT_SETTINGS,
);
// ~/~ end
