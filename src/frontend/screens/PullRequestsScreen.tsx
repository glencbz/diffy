// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-screen-pull-requests>>[init]
import { PullRequests } from "../controllers/PullRequests";
import { type Place, type PullPlace, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function PullRequestsScreen({
  place,
  onGo,
}: {
  place: PullPlace | null;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode="pulls"
        onSelect={(mode) => {
          if (mode !== "pulls") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      <PullRequests
        place={place}
        review={review}
        onGo={(pull, visit) => onGo({ tab: "pulls", pull }, visit)}
      />
    </div>
  );
}
// ~/~ end
