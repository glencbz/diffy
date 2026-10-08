// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-view-mode-tabs>>[init]
export type Mode =
  | "reviews"
  | "local-guided"
  | "local"
  | "pulls"
  | "pull-guided"
  | "settings";

const CAPTIONS: Record<Mode, string> = {
  reviews: "Local reviews",
  "local-guided": "Local guided",
  local: "Operations",
  pulls: "Pull requests",
  "pull-guided": "Pull guided",
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
