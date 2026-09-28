// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-controller-local-reviews>>[init]
import { type LocalPlace, localHref, openLocal } from "../model/place";
import {
  type LocalReview,
  localReview,
  localRowKey,
  localSeries,
} from "../model/review";
import { localHistory } from "../model/series";
import type { ReviewHandle } from "../state/review";
import { LocalReviewList } from "../views/LocalReviewList";
import { Message } from "../views/Message";
import { CommitLog } from "./CommitLog";
import { SeriesReview, type SeriesScreen } from "./SeriesReview";

export function LocalReviews({
  place,
  review,
  onGo,
}: {
  place: LocalPlace | null;
  review: ReviewHandle;
  onGo: (place: LocalPlace | null) => void;
}) {
  if (review.status === "loading") {
    return <Message>Loading local reviews...</Message>;
  }

  const reviews = review.document.localReviews;
  const open =
    place === null ? undefined : localReview(review.document, place.name);

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
          selected={open?.name ?? null}
          onSelect={(name) =>
            onGo(name === place?.name ? place : openLocal(name))
          }
          commits={(version) => (
            <CommitLog
              source={{ kind: "local", commits: version.commits }}
              selected={[]}
            />
          )}
        />
      </div>
      <div className="pane pane--main">
        {open === undefined || place === null ? (
          <Message>
            {reviews.length === 0
              ? "Nothing is registered for review yet."
              : "Select a local review to read it."}
          </Message>
        ) : (
          <LocalReviewScreen
            key={open.name}
            local={open}
            place={place}
            review={review}
            onGo={onGo}
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
}: {
  local: LocalReview;
  place: LocalPlace;
  review: ReviewHandle;
  onGo: (place: LocalPlace) => void;
}) {
  const { name } = local;
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
      onGo={(next) => onGo({ ...next, name })}
      href={(next) => localHref({ ...next, name })}
    />
  );
}
// ~/~ end
