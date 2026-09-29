// ~/~ begin <<docs/architecture/frontend/review.md#frontend-view-review-strip>>[init]
/** A line across the screen when review state cannot be shown or a change
 *  to it was lost. Nothing at all while it loads or once it has loaded. */
export function ReviewStrip({
  unavailable,
  failure,
  onDismiss,
}: {
  /** Why the review document could not be read, if it could not. */
  unavailable: string | null;
  /** Why the last change could not be saved, if it could not. */
  failure: string | null;
  onDismiss: () => void;
}) {
  if (unavailable === null && failure === null) return null;
  return (
    <div className="review-strip" role="status">
      {unavailable !== null && (
        <p className="review-strip__note">
          Review state is unavailable, so marks and comments are hidden:{" "}
          {unavailable}
        </p>
      )}
      {failure !== null && (
        <p className="review-strip__note">
          {failure}{" "}
          <button
            type="button"
            className="review-strip__dismiss"
            onClick={onDismiss}
          >
            dismiss
          </button>
        </p>
      )}
    </div>
  );
}
// ~/~ end
