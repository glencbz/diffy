// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-view-settings-screen>>[init]
import type {
  DiffLayout,
  DiffMode,
  Settings,
  TextSize,
} from "../state/settings";

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
  { value: "split", caption: "Side by side, for line diffs on wide screens" },
];

export function SettingsScreen({
  settings,
  onSetTextSize,
  onSetDiffMode,
  onSetDiffLayout,
}: {
  settings: Settings;
  onSetTextSize: (textSize: TextSize) => void;
  onSetDiffMode: (diffMode: DiffMode) => void;
  onSetDiffLayout: (diffLayout: DiffLayout) => void;
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
    </div>
  );
}
// ~/~ end
