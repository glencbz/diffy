// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-screen-tour>>[init]
import { LocalTours, PullTours } from "../controllers/Tours";
import { openLocal, openPull, type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function TourScreen({
  place,
  onGo,
}: {
  place: Extract<Place, { tab: "local-tour" | "pull-tour" }>;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode={place.tab}
        onSelect={(mode) => {
          if (mode === place.tab) return;
          // The screen of the series a tour reads opens on the same series.
          if (
            mode === "reviews" &&
            place.tab === "local-tour" &&
            place.review !== null
          ) {
            onGo({ tab: "reviews", review: openLocal(place.review.name) });
          } else if (
            mode === "pulls" &&
            place.tab === "pull-tour" &&
            place.pull !== null
          ) {
            onGo({ tab: "pulls", pull: openPull(place.pull.number) });
          } else onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      {place.tab === "local-tour" ? (
        <LocalTours
          place={place.review}
          review={review}
          onGo={(next, visit) =>
            onGo({ tab: "local-tour", review: next }, visit)
          }
        />
      ) : (
        <PullTours
          place={place.pull}
          review={review}
          onGo={(next, visit) => onGo({ tab: "pull-tour", pull: next }, visit)}
        />
      )}
    </div>
  );
}
// ~/~ end
