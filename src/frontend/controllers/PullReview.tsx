// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-review>>[init]
import { useState } from "react";
import type { GitOid, PullBaseline, PullSummary } from "../api";
import { usePullHistory } from "../state/pullHistory";
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullHeader } from "../views/PullHeader";
import { PullReviewPanes } from "../views/PullPanes";
import { PullTimeline } from "../views/PullTimeline";
import { CommitLog } from "./CommitLog";
import { DiffPane } from "./DiffPane";

export function PullReview({
  repo,
  pull,
  session,
}: {
  repo: string;
  pull: PullSummary;
  session: Session;
}) {
  const history = usePullHistory(repo, pull.number);
  const [before, setBefore] = useState<PullBaseline | null>(null);
  const [after, setAfter] = useState<GitOid | null>(null);

  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  const states = history.data.states;
  const first = states[0];
  const latest = states.at(-1);
  if (first === undefined || latest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const from: PullBaseline = before ?? { kind: "version", head: first.head };
  const to = after ?? latest.head;
  const number = pull.number;

  return (
    <PullReviewPanes
      header={<PullHeader pull={pull} />}
      timeline={
        <PullTimeline
          states={states}
          // A baseline that is not a head has no chip to mark, and the base
          // branch tip is never one of the heads.
          before={from.kind === "version" ? from.head : history.data.baseRefOid}
          after={to}
          onPick={(head, end) => {
            if (end === "before") setBefore({ kind: "version", head });
            else setAfter(head);
          }}
        />
      }
      commits={
        <CommitLog
          source={{ kind: "pull", repo, number, head: to }}
          selected={[]}
        />
      }
      diff={
        <DiffPane
          comparison={{ kind: "pull", repo, number, from, to }}
          session={session}
        />
      }
    />
  );
}
// ~/~ end
