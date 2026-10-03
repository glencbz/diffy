// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-review-toggle>>[init]
export function ReviewToggle({
  open,
  ticked,
  onToggle,
}: {
  open: boolean;
  ticked: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={open ? "review-toggle review-toggle--open" : "review-toggle"}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={
        open
          ? "close the review strip"
          : "register the ticked commits as a local review"
      }
    >
      {ticked === 0 ? "review" : `review ${ticked}`}
    </button>
  );
}
// ~/~ end
