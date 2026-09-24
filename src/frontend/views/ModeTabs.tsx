// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-view-mode-tabs>>[init]
export type Mode = "local" | "pulls" | "settings";

const CAPTIONS: Record<Mode, string> = {
  local: "Local history",
  pulls: "Pull requests",
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
