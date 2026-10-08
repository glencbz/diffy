// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-review>>[init]
import { useMemo } from "react";
import { GitOid } from "../model/history";
import { type PullPlace, pullHref } from "../model/place";
import type { PullSummary } from "../model/pull";
import { pullRowKey, pullSeries } from "../model/review";
import { pullHistory } from "../model/series";
import type { Visit } from "../state/place";
import { usePullHistory } from "../state/pullHistory";
import type { ReviewHandle } from "../state/review";
import { Message } from "../views/Message";
import { PullHeader } from "../views/PullHeader";
import { type Guiding, SeriesReview, type SeriesScreen } from "./SeriesReview";

export function PullReview({
  repo,
  number,
  pull,
  place,
  review,
  onGo,
  guiding,
}: {
  repo: string;
  number: number;
  /** Null for a pull request older than the list holds. */
  pull: PullSummary | null;
  place: PullPlace;
  review: ReviewHandle;
  onGo: (place: PullPlace, visit?: Visit) => void;
  guiding: Guiding | null;
}) {
  const answer = usePullHistory(repo, number);
  const tab = guiding === null ? "pulls" : "pull-guided";
  const history = useMemo(
    () => (answer.status === "ready" ? pullHistory(answer.data) : null),
    [answer],
  );

  if (answer.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }
  if (history === null || history.versions.length === 0) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const screen: SeriesScreen = {
    source: { kind: "pull", repo, number },
    series: pullSeries(repo, number),
    history,
    header: (
      <PullHeader
        number={number}
        pull={pull}
        classic={
          guiding === null ? null : pullHref({ ...place, number }, "pulls")
        }
      />
    ),
    wholeLabel: "whole pull request",
    keyOf: (document, before, after) =>
      pullRowKey(document, before?.commitId ?? null, after?.commitId ?? null),
    lane: (id) => ({ kind: "pull", repo, number, head: GitOid.parse(id) }),
  };

  return (
    <SeriesReview
      screen={screen}
      place={place}
      review={review}
      onGo={(next, visit) => onGo({ ...next, number }, visit)}
      href={(next) => pullHref({ ...next, number }, tab)}
      guiding={guiding}
    />
  );
}
// ~/~ end
