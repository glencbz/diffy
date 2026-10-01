// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-interdiff-toggle>>[init]
export function InterdiffToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="interdiff-toggle"
      onClick={onToggle}
      aria-label={
        open ? "close the interdiff" : "interdiff against another operation"
      }
    >
      {open ? "close" : "interdiff"}
    </button>
  );
}
// ~/~ end
