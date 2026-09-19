// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-pull-requests>>[init]
import { useState } from "react";
import { usePulls } from "../state/pulls";
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

export function PullRequests({
  repo,
  session,
}: {
  repo: string;
  session: Session;
}) {
  const pulls = usePulls(repo);
  const [selected, setSelected] = useState<number | null>(null);

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const pull = pulls.data.find((candidate) => candidate.number === selected);

  return (
    <PullPanes
      list={
        <PullList
          pulls={pulls.data}
          selected={selected}
          onSelect={setSelected}
        />
      }
      review={
        pull === undefined ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview
            key={pull.number}
            repo={repo}
            pull={pull}
            session={session}
          />
        )
      }
    />
  );
}
// ~/~ end
