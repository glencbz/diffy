// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-view-mode-tabs>>[init]
export type Mode =
  | "reviews"
  | "local-tour"
  | "local"
  | "pulls"
  | "pull-tour"
  | "settings";

const CAPTIONS: Record<Mode, string> = {
  reviews: "Local reviews",
  "local-tour": "Local tour",
  local: "Operations",
  pulls: "Pull requests",
  "pull-tour": "Pull tour",
  settings: "Settings",
};

export function ModeTabs({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <nav className="tabs">
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
