// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-app>>[init]
import type { Place } from "./model/place";
import { LocalHistoryScreen } from "./screens/LocalHistoryScreen";
import { LocalReviewsScreen } from "./screens/LocalReviewsScreen";
import { OpenRepoScreen } from "./screens/OpenRepoScreen";
import { PullRequestsScreen } from "./screens/PullRequestsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LocalHistoryContext, useLocalHistory } from "./state/localHistory";
import { usePlace } from "./state/place";
import { RepoContext, useServedRepo } from "./state/repo";
import { ReviewContext, useReview } from "./state/review";
import { SettingsContext, useSettings } from "./state/settings";
import { Message } from "./views/Message";

export function App() {
  const repo = useServedRepo();
  return <RepoContext value={repo}>{served(repo.served)}</RepoContext>;
}

function served(repo: ReturnType<typeof useServedRepo>["served"]) {
  switch (repo.status) {
    case "loading":
      return null;
    case "error":
      return (
        <div className="app">
          <Message tone="error">{repo.message}</Message>
        </div>
      );
    case "ready":
      return repo.data.current === null ? (
        <OpenRepoScreen home={repo.data.home} />
      ) : (
        <Screens />
      );
  }
}

function Screens() {
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
  }
}
// ~/~ end
