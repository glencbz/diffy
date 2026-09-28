# Local reviews

A local review is a series registered as ready for review, by an agent
through the server's route; each registration is a version. The [direction](../../direction.md#a-local-review-is-registered)
says why a review is registered rather than read off every bookmark.

## The screen

```tsx
//| id: frontend-screen-local-reviews
//| file: src/frontend/screens/LocalReviewsScreen.tsx
import { LocalReviews } from "../controllers/LocalReviews";
import { type LocalPlace, type Place, tabPlace } from "../model/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function LocalReviewsScreen({
  place,
  onGo,
}: {
  place: LocalPlace | null;
  onGo: (place: Place) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode="reviews"
        onSelect={(mode) => {
          if (mode !== "reviews") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      <LocalReviews
        place={place}
        review={review}
        onGo={(local) => onGo({ tab: "reviews", review: local })}
      />
    </div>
  );
}
```

## Local reviews controller

The list is the review document's `localReviews`, so it needs no load of its
own, and a review an agent registers appears on an open screen as soon as the
server announces the change. Each entry draws its newest version's commits
as a graph, since a name and a revset do not say which commits they are.

A picked review reads in the
[series review screen](pull-requests.md#series-review-controller), and
`LocalReviewScreen` fills in what differs. A row is filed by
[`localRowKey`](review.md#review-state) under its change id, which survives
the rewrites between one registration and the next.

The panes are the pull request screen's. The rail returns to the list rather
than opening it over the review as the pull request screen's sheet does,
since a phone has no room for both.

```tsx
//| id: frontend-controller-local-reviews
//| file: src/frontend/controllers/LocalReviews.tsx
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
```

## The list

An entry is its name, how many versions it has, and the newest version's
revset over that version's commits. The graph comes in through `commits`,
since loading commits is a controller's job and the list is a view. The
graph picks nothing, so a click anywhere on the entry opens the review.

```tsx
//| id: frontend-view-local-review-list
//| file: src/frontend/views/LocalReviewList.tsx
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
```

The entry keeps the list's item styling; the button inside it fills the row
like the item it replaces, and the graph sits flush beneath it.

```css
/*| id: design-local-review-list
@layer components {
  .local-review__open {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .local-review__commits {
    margin-top: var(--space-3);
    cursor: pointer;
  }
}
```
