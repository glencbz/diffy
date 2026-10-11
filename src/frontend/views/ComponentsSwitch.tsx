// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-switch>>[init]
import type { ComponentsShown } from "../model/settings";

/** Lays a series' components over its diff, or takes them off. A switch,
 *  so it reads as a way of reading rather than one more link in the bar.
 *  A version with no map still shows it, off and disabled, so the reader
 *  learns the mode is there and why it is not on. */
export function ComponentsSwitch({
  shown,
  disabled,
  onChange,
}: {
  shown: ComponentsShown;
  disabled: boolean;
  onChange: (shown: ComponentsShown) => void;
}) {
  const on = shown === "shown" && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className="components-switch-mode"
      title={
        disabled
          ? "no component map for this version yet: an agent writes one with write_components"
          : "label each part of the diff with the component it is"
      }
      onClick={() => onChange(on ? "hidden" : "shown")}
    >
      <span className="components-switch-mode__track" aria-hidden="true" />
      Components
    </button>
  );
}
// ~/~ end
