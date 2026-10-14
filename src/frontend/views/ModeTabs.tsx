// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-view-mode-tabs>>[init]
import type { ReactNode } from "react";

export type Mode = "reviews" | "local" | "pulls" | "settings";

const CAPTIONS: Record<Mode, string> = {
  reviews: "Local reviews",
  local: "Operations",
  pulls: "Pull requests",
  settings: "Settings",
};

export function ModeTabs({
  repo,
  mode,
  onSelect,
}: {
  /** The repository switcher, wired by the screen. */
  repo: ReactNode;
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <nav className="tabs">
      {repo}
      {(Object.keys(CAPTIONS) as Mode[]).map((candidate) => (
        <button
          type="button"
          key={candidate}
          onClick={() => onSelect(candidate)}
          className={candidate === mode ? "tab tab--current" : "tab"}
          aria-current={candidate === mode}
        >
          {CAPTIONS[candidate]}
        </button>
      ))}
    </nav>
  );
}
// ~/~ end
