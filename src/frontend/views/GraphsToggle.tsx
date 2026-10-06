// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-graphs-toggle>>[init]
export function GraphsToggle({
  oneGraph,
  onToggle,
}: {
  oneGraph: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="interdiff-toggle"
      onClick={onToggle}
      aria-label={
        oneGraph
          ? "show the interdiff on two graphs"
          : "show the interdiff on one graph"
      }
    >
      {oneGraph ? "two graphs" : "one graph"}
    </button>
  );
}
// ~/~ end
