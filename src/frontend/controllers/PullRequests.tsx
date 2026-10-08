// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-requests>>[init]
import { useState } from "react";
import { guideTo } from "../model/guide";
import { openPull, type PullChoice, type PullPlace } from "../model/place";
import type { PullSummary } from "../model/pull";
import { pullSeries } from "../model/review";
import type { Visit } from "../state/place";
import { usePulls } from "../state/pulls";
import type { ReviewHandle } from "../state/review";
import { Message } from "../views/Message";
import { PullPanes } from "../views/PullPanes/PullPanes";
import { PullReview } from "./PullReview";
import type { Guiding } from "./SeriesReview";

export function PullRequests({
  place,
  review,
  onGo,
  guiding = null,
}: {
  place: PullPlace | null;
  review: ReviewHandle;
  onGo: (place: PullPlace | null, visit?: Visit) => void;
  /** Set on a guided read. */
  guiding?: Guiding | null;
}) {
  const pulls = usePulls();
  const [sheetOver, setSheetOver] = useState<number | null>(null);

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const { repo } = pulls.data;
  const choice = chosen(place, sheetOver, pulls.data.pulls);

  return (
    <PullPanes
      choice={choice}
      onOpen={() => setSheetOver(place?.number ?? null)}
      onDismiss={() => setSheetOver(null)}
      pulls={pulls.data.pulls}
      onSelect={(number) => {
        setSheetOver(null);
        onGo(number === place?.number ? place : openPull(number));
      }}
      guided={
        guiding === null
          ? undefined
          : (pull) =>
              guideTo(
                review.document.guides,
                pullSeries(repo, pull.number),
                pull.headRefOid,
              ) !== undefined
      }
      review={
        choice.phase === "browsing" || place === null ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview
            key={choice.number}
            repo={repo}
            number={choice.number}
            pull={choice.pull}
            place={place}
            review={review}
            onGo={onGo}
            guiding={guiding}
          />
        )
      }
    />
  );
}

function chosen(
  place: PullPlace | null,
  sheetOver: number | null,
  pulls: PullSummary[],
): PullChoice {
  if (place === null) return { phase: "browsing" };
  const { number } = place;
  const pull = pulls.find((candidate) => candidate.number === number) ?? null;
  return {
    phase: sheetOver === number ? "picking" : "reviewing",
    number,
    pull,
  };
}
// ~/~ end
