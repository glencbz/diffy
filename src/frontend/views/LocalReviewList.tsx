// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-local-review-list>>[init]
import type { ReactNode } from "react";
import type {
  LocalReview,
  LocalReviewListVariant,
  LocalVersion,
} from "../model/review";

export function LocalReviewList({
  reviews,
  forgotten,
  selected,
  onSelect,
  variant,
  commits,
}: {
  reviews: LocalReview[];
  forgotten: LocalReview[];
  selected: string | null;
  onSelect: (name: string) => void;
  variant: LocalReviewListVariant;
  /** The graph of one version's commits. */
  commits: (version: LocalVersion) => ReactNode;
}) {
  return (
    <div>
      {reviews.map((review) => {
        const newest = review.versions.at(-1);
        return (
          <div
            key={review.name}
            className={
              review.name === selected
                ? "pull-list__item pull-list__item--selected local-review"
                : "pull-list__item local-review"
            }
          >
            <div className="local-review__head">
              <button
                type="button"
                onClick={() => onSelect(review.name)}
                className="local-review__open"
              >
                <span className="pull-list__row">
                  <span className="pull-list__number">
                    v{review.versions.length}
                  </span>
                  <span className="pull-list__title">{review.name}</span>
                </span>
                {newest !== undefined && (
                  <span className="pull-list__base">{newest.revset}</span>
                )}
              </button>
              {variant.kind === "writable" && (
                <button
                  type="button"
                  aria-label={`forget the local review ${review.name}`}
                  onClick={() => variant.onForget(review.name)}
                  className="local-review__action local-review__action--danger"
                >
                  delete
                </button>
              )}
            </div>
            {newest !== undefined && (
              // biome-ignore lint/a11y/noStaticElementInteractions: the button above opens the same review for keyboards
              // biome-ignore lint/a11y/useKeyWithClickEvents: the button above opens the same review for keyboards
              <div
                onClick={() => onSelect(review.name)}
                className="local-review__commits"
              >
                {commits(newest)}
              </div>
            )}
          </div>
        );
      })}
      {forgotten.length > 0 && (
        <>
          <div className="local-review__deleted">recently deleted</div>
          {forgotten.map((review) => (
            <div
              key={review.name}
              className="pull-list__item local-review local-review--forgotten"
            >
              <div className="local-review__head">
                <span className="local-review__label">
                  <span className="pull-list__title">{review.name}</span>
                  <span className="pull-list__base">
                    {review.versions.at(-1)?.revset}
                  </span>
                </span>
                {variant.kind === "writable" && (
                  <button
                    type="button"
                    aria-label={`restore the local review ${review.name}`}
                    onClick={() => variant.onRestore(review.name)}
                    className="local-review__action"
                  >
                    restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
// ~/~ end
