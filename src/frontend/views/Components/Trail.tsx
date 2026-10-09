// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-trail>>[init]
/** The places the reader came from, newest last, each one a way back. */
export function Trail({
  labels,
  onBack,
  onForget,
}: {
  labels: string[];
  onBack: (index: number) => void;
  onForget: () => void;
}) {
  if (labels.length === 0) return null;
  const shown = labels.slice(-4);
  const skipped = labels.length - shown.length;
  return (
    <div className="components-trail">
      <span className="components-trail__label">came from</span>
      {shown.map((label, index) => {
        const at = skipped + index;
        return (
          <button
            type="button"
            key={at}
            className={
              at === labels.length - 1 ? "components-trail--back" : undefined
            }
            onClick={() => onBack(at)}
          >
            {label}
          </button>
        );
      })}
      <button type="button" onClick={onForget} aria-label="forget the trail">
        ✕
      </button>
    </div>
  );
}
// ~/~ end
