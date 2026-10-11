// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-switch>>[init]
import type { ComponentsShown } from "../model/settings";

/** Lays a series' components over its diff, or takes them off. A switch,
 *  so it reads as a way of reading rather than one more link in the bar. */
export function ComponentsSwitch({
  shown,
  onChange,
}: {
  shown: ComponentsShown;
  onChange: (shown: ComponentsShown) => void;
}) {
  const on = shown === "shown";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="components-switch-mode"
      title="label each part of the diff with the component it is"
      onClick={() => onChange(on ? "hidden" : "shown")}
    >
      <span className="components-switch-mode__track" aria-hidden="true" />
      Components
    </button>
  );
}
// ~/~ end
