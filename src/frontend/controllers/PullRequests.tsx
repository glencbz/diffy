// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-requests>>[init]
import { useState } from "react";
import { openPull, type PullPlace } from "../model/place";
import type { PullSummary } from "../model/pull";
import { usePulls } from "../state/pulls";
import type { ReviewHandle } from "../state/review";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { type PullChoice, PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

export function PullRequests({
  place,
  review,
  onGo,
}: {
  place: PullPlace | null;
  review: ReviewHandle;
  onGo: (place: PullPlace | null) => void;
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
      list={
        <PullList
          pulls={pulls.data.pulls}
          selected={choice.phase === "browsing" ? null : choice.pull.number}
          onSelect={(number) => {
            setSheetOver(null);
            onGo(number === place?.number ? place : openPull(number));
          }}
        />
      }
      review={
        choice.phase === "browsing" || place === null ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview
            key={choice.pull.number}
            repo={repo}
            pull={choice.pull}
            place={place}
            review={review}
            onGo={onGo}
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
  const pull = pulls.find((candidate) => candidate.number === place.number);
  if (pull === undefined) return { phase: "browsing" };
  return { phase: sheetOver === pull.number ? "picking" : "reviewing", pull };
}
// ~/~ end
