// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-controller-local-reviews>>[init]
import { useState } from "react";
import { guideTo } from "../model/guide";
import { type LocalPlace, localHref, openLocal } from "../model/place";
import {
  type LocalReview,
  type LocalReviewOrder,
  localReview,
  localRowKey,
  localSeries,
  sortLocalReviews,
} from "../model/review";
import { localHistory } from "../model/series";
import type { Visit } from "../state/place";
import type { ReviewHandle } from "../state/review";
import { LocalReviewList } from "../views/LocalReviewList";
import { Message } from "../views/Message";
import { CommitLog } from "./CommitLog";
import { type Guiding, SeriesReview, type SeriesScreen } from "./SeriesReview";

export function LocalReviews({
  place,
  review,
  onGo,
  guiding = null,
}: {
  place: LocalPlace | null;
  review: ReviewHandle;
  onGo: (place: LocalPlace | null, visit?: Visit) => void;
  /** Set on a guided read. */
  guiding?: Guiding | null;
}) {
  const [order, setOrder] = useState<LocalReviewOrder>("modified-newest");

  if (review.status === "loading") {
    return <Message>Loading local reviews...</Message>;
  }

  const reviews = sortLocalReviews(
    review.document.localReviews.filter(
      (local) => local.forgottenAt === undefined,
    ),
    order,
  );
  const forgotten = review.document.localReviews.filter(
    (local) => local.forgottenAt !== undefined,
  );
  const found =
    place === null ? undefined : localReview(review.document, place.name);
  const open = found?.forgottenAt === undefined ? found : undefined;

  return (
    <div
      className={`panes panes--${open === undefined ? "browsing" : "reviewing"}`}
    >
      {open !== undefined && (
        <button
          type="button"
          aria-label="show the local review list"
          onClick={() => onGo(null)}
          className="pull-rail"
        >
          local reviews
        </button>
      )}
      <div className="pane pane--list">
        <LocalReviewList
          reviews={reviews}
          forgotten={forgotten}
          selected={open?.name ?? null}
          order={order}
          onOrder={setOrder}
          onSelect={(name) =>
            onGo(name === place?.name ? place : openLocal(name))
          }
          variant={
            review.status === "ready"
              ? {
                  kind: "writable",
                  onForget: (name) => {
                    review.actions.forgetReview(name);
                    if (name === place?.name) onGo(null);
                  },
                  onRestore: review.actions.restoreReview,
                }
              : { kind: "read-only" }
          }
          commits={(version) => (
            <CommitLog
              source={{ kind: "local", commits: version.commits }}
              selected={[]}
            />
          )}
          guided={
            guiding === null
              ? undefined
              : (local) =>
                  guideTo(
                    review.document.guides,
                    localSeries(local.name),
                    String(local.versions.length),
                  ) !== undefined
          }
        />
      </div>
      <div className="pane pane--main">
        {open === undefined || place === null ? (
          <Message>
            {reviews.length === 0
              ? "Nothing is registered for review yet. Tick its commits in Operations and press review."
              : "Select a local review to read it."}
          </Message>
        ) : (
          <LocalReviewScreen
            key={open.name}
            local={open}
            place={place}
            review={review}
            onGo={onGo}
            guiding={guiding}
          />
        )}
      </div>
    </div>
  );
}

function LocalReviewScreen({
  local,
  place,
  review,
  onGo,
  guiding,
}: {
  local: LocalReview;
  place: LocalPlace;
  review: ReviewHandle;
  onGo: (place: LocalPlace, visit?: Visit) => void;
  guiding: Guiding | null;
}) {
  const { name } = local;
  const tab = guiding === null ? "reviews" : "local-guided";
  const screen: SeriesScreen = {
    source: { kind: "local", review: local },
    series: localSeries(name),
    history: localHistory(local),
    header: (
      <header className="pull-header">
        <strong className="pull-header__title">{name}</strong>
        <span className="pull-header__meta">
          {local.versions.at(-1)?.revset}
        </span>
        {guiding !== null && (
          <a
            href={localHref({ ...place, name }, "reviews")}
            className="pull-header__link"
          >
            classic view
          </a>
        )}
      </header>
    ),
    wholeLabel: "whole review",
    keyOf: (_document, before, after) => localRowKey(before, after),
    lane: (id) => ({
      kind: "local",
      commits: local.versions[Number(id) - 1]?.commits ?? [],
    }),
  };

  return (
    <SeriesReview
      screen={screen}
      place={place}
      review={review}
      onGo={(next, visit) => onGo({ ...next, name }, visit)}
      href={(next) => localHref({ ...next, name }, tab)}
      guiding={guiding}
    />
  );
}
// ~/~ end
