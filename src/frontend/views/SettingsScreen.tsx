// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-view-settings-screen>>[init]
import type { Settings, TextSize } from "../state/settings";

const TEXT_SIZES: { value: TextSize; caption: string }[] = [
  { value: "small", caption: "Small" },
  { value: "standard", caption: "Standard" },
  { value: "large", caption: "Large" },
  { value: "larger", caption: "Larger" },
];

export function SettingsScreen({
  settings,
  onSetTextSize,
}: {
  settings: Settings;
  onSetTextSize: (textSize: TextSize) => void;
}) {
  return (
    <div className="settings">
      <fieldset className="settings__section">
        <legend>Display</legend>
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
    </div>
  );
}
// ~/~ end
