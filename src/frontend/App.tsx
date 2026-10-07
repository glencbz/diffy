// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-app>>[init]
import type { Place } from "./model/place";
import { LocalHistoryScreen } from "./screens/LocalHistoryScreen";
import { LocalReviewsScreen } from "./screens/LocalReviewsScreen";
import { PullRequestsScreen } from "./screens/PullRequestsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TourScreen } from "./screens/TourScreen";
import { LocalHistoryContext, useLocalHistory } from "./state/localHistory";
import { usePlace } from "./state/place";
import { ReviewContext, useReview } from "./state/review";
import { SettingsContext, useSettings } from "./state/settings";

export function App() {
  const [place, go] = usePlace();
  const settings = useSettings();
  const review = useReview();
  const localHistory = useLocalHistory();

  return (
    <SettingsContext value={settings}>
      <ReviewContext value={review}>
        <LocalHistoryContext value={localHistory}>
          {screenAt(place, go)}
        </LocalHistoryContext>
      </ReviewContext>
    </SettingsContext>
  );
}

function screenAt(place: Place, go: (place: Place) => void) {
  switch (place.tab) {
    case "reviews":
      return <LocalReviewsScreen place={place.review} onGo={go} />;
    case "local":
      return <LocalHistoryScreen onGo={go} />;
    case "pulls":
      return <PullRequestsScreen place={place.pull} onGo={go} />;
    case "settings":
      return <SettingsScreen onGo={go} />;
    case "local-tour":
    case "pull-tour":
      return <TourScreen place={place} onGo={go} />;
  }
}
// ~/~ end
