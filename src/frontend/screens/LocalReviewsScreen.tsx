// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-screen-local-reviews>>[init]
import { LocalReviews } from "../controllers/LocalReviews";
import { type LocalPlace, type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function LocalReviewsScreen({
  place,
  onGo,
}: {
  place: LocalPlace | null;
  onGo: (place: Place, visit?: Visit) => void;
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
        onGo={(local, visit) => onGo({ tab: "reviews", review: local }, visit)}
      />
    </div>
  );
}
// ~/~ end
