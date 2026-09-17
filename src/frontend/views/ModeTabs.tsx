// ~/~ begin <<docs/architecture/frontend.md#frontend-view-mode-tabs>>[init]
export type Mode = "local" | "pulls";

const CAPTIONS: Record<Mode, string> = {
  local: "Local history",
  pulls: "Pull requests",
};

export function ModeTabs({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <nav
      style={{
        display: "flex",
        flex: "none",
        background: "#f0f0f0",
        borderBottom: "1px solid #ccc",
      }}
    >
      {(Object.keys(CAPTIONS) as Mode[]).map((candidate) => (
        <button
          type="button"
          key={candidate}
          onClick={() => onSelect(candidate)}
          style={{
            padding: "6px 14px",
            font: "inherit",
            fontWeight: candidate === mode ? "bold" : "normal",
            color: candidate === mode ? "#0969da" : "#333",
            cursor: "pointer",
            border: "none",
            borderBottom:
              candidate === mode
                ? "2px solid #0969da"
                : "2px solid transparent",
            background: "transparent",
          }}
        >
          {CAPTIONS[candidate]}
        </button>
      ))}
    </nav>
  );
}
// ~/~ end
