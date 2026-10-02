// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-screen-settings>>[init]
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
// ~/~ end
