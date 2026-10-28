// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-local-review-list>>[init]
import type { ReactNode } from "react";
import type {
  ForgottenReviewOrder,
  LocalReview,
  LocalReviewListVariant,
  LocalReviewOrder,
  LocalVersion,
} from "../model/review";
import {
  FORGOTTEN_REVIEW_ORDERS,
  LOCAL_REVIEW_ORDERS,
  reviewSubject,
} from "../model/review";

const ORDER_LABELS: Record<LocalReviewOrder, string> = {
  "modified-newest": "Modified, newest first",
  "modified-oldest": "Modified, oldest first",
  name: "Name",
};

const FORGOTTEN_ORDER_LABELS: Record<ForgottenReviewOrder, string> = {
  "deleted-newest": "Deleted, newest first",
  "deleted-oldest": "Deleted, oldest first",
  name: "Name",
};

function OrderSelect<Order extends string>({
  order,
  choices,
  labels,
  onOrder,
}: {
  order: Order;
  choices: readonly Order[];
  labels: Record<Order, string>;
  onOrder: (order: Order) => void;
}) {
  return (
    <label className="local-review__order">
      Sort by{" "}
      <select
        value={order}
        onChange={(event) => onOrder(event.target.value as Order)}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {labels[choice]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LocalReviewList({
  reviews,
  forgotten,
  selected,
  order,
  onOrder,
  forgottenOrder,
  onForgottenOrder,
  onSelect,
  variant,
  commits,
}: {
  reviews: LocalReview[];
  forgotten: LocalReview[];
  selected: string | null;
  order: LocalReviewOrder;
  onOrder: (order: LocalReviewOrder) => void;
  forgottenOrder: ForgottenReviewOrder;
  onForgottenOrder: (order: ForgottenReviewOrder) => void;
  onSelect: (name: string) => void;
  variant: LocalReviewListVariant;
  /** The graph of one version's commits. */
  commits: (version: LocalVersion) => ReactNode;
}) {
  return (
    <div>
      <OrderSelect
        order={order}
        choices={LOCAL_REVIEW_ORDERS}
        labels={ORDER_LABELS}
        onOrder={onOrder}
      />
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
                  <span className="pull-list__title">
                    {reviewSubject(review)}
                  </span>
                </span>
                {newest !== undefined && (
                  <span className="pull-list__base">
                    {newest.description === undefined
                      ? newest.revset
                      : review.name}
                  </span>
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
        <details className="local-review__deleted">
          <summary>recently deleted ({forgotten.length})</summary>
          <OrderSelect
            order={forgottenOrder}
            choices={FORGOTTEN_REVIEW_ORDERS}
            labels={FORGOTTEN_ORDER_LABELS}
            onOrder={onForgottenOrder}
          />
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
        </details>
      )}
    </div>
  );
}
// ~/~ end
