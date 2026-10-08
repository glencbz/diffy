// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-screen-guided>>[init]
import { LocalReviews } from "../controllers/LocalReviews";
import { PullRequests } from "../controllers/PullRequests";
import { type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { useSettingsContext } from "../state/settings";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

/** The local review and pull request screens with each version's guide laid
 *  over its stack. */
export function GuidedScreen({
  place,
  onGo,
}: {
  place: Extract<Place, { tab: "local-guided" | "pull-guided" }>;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();
  const { settings, setGuideNotes } = useSettingsContext();
  const guiding = {
    notes: { at: settings.display.guideNotes, onChange: setGuideNotes },
  };

  return (
    <div className="app">
      <ModeTabs
        mode={place.tab}
        onSelect={(mode) => {
          if (mode === place.tab) return;
          // The screen of the series being read opens on the same place.
          if (mode === "reviews" && place.tab === "local-guided") {
            onGo({ tab: "reviews", review: place.review });
          } else if (mode === "pulls" && place.tab === "pull-guided") {
            onGo({ tab: "pulls", pull: place.pull });
          } else onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      {place.tab === "local-guided" ? (
        <LocalReviews
          place={place.review}
          review={review}
          guiding={guiding}
          onGo={(next, visit) =>
            onGo({ tab: "local-guided", review: next }, visit)
          }
        />
      ) : (
        <PullRequests
          place={place.pull}
          review={review}
          guiding={guiding}
          onGo={(next, visit) =>
            onGo({ tab: "pull-guided", pull: next }, visit)
          }
        />
      )}
    </div>
  );
}
// ~/~ end
