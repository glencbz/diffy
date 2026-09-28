// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-local-review-list>>[init]
import type { ReactNode } from "react";
import type { LocalReview, LocalVersion } from "../model/review";

export function LocalReviewList({
  reviews,
  selected,
  onSelect,
  commits,
}: {
  reviews: LocalReview[];
  selected: string | null;
  onSelect: (name: string) => void;
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
                ? "pull-list__item pull-list__item--selected"
                : "pull-list__item"
            }
          >
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
    </div>
  );
}
// ~/~ end
