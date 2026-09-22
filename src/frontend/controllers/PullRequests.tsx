// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-controller-pull-requests>>[init]
import { useState } from "react";
import type { PullSummary } from "../api";
import { usePulls } from "../state/pulls";
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullList } from "../views/PullList";
import { type PullChoice, PullPanes } from "../views/PullPanes";
import { PullReview } from "./PullReview";

type Screen =
  | { phase: "browsing" }
  | { phase: "reviewing"; pull: number }
  | { phase: "picking"; pull: number };

export function PullRequests({
  repo,
  session,
}: {
  repo: string;
  session: Session;
}) {
  const pulls = usePulls(repo);
  const [screen, setScreen] = useState<Screen>({ phase: "browsing" });

  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }

  const choice = chosen(screen, pulls.data);

  return (
    <PullPanes
      choice={choice}
      onOpen={() => setScreen(openList)}
      onDismiss={() => setScreen(dismissList)}
      list={
        <PullList
          pulls={pulls.data}
          selected={choice.phase === "browsing" ? null : choice.pull.number}
          onSelect={(pull) => setScreen({ phase: "reviewing", pull })}
        />
      }
      review={
        choice.phase === "browsing" ? (
          <Message>Select a pull request to review it.</Message>
        ) : (
          <PullReview
            key={choice.pull.number}
            repo={repo}
            pull={choice.pull}
            session={session}
          />
        )
      }
    />
  );
}

function chosen(screen: Screen, pulls: PullSummary[]): PullChoice {
  if (screen.phase === "browsing") return screen;
  const pull = pulls.find((candidate) => candidate.number === screen.pull);
  if (pull === undefined) return { phase: "browsing" };
  return { phase: screen.phase, pull };
}

function openList(screen: Screen): Screen {
  if (screen.phase !== "reviewing") return screen;
  return { phase: "picking", pull: screen.pull };
}

function dismissList(screen: Screen): Screen {
  if (screen.phase !== "picking") return screen;
  return { phase: "reviewing", pull: screen.pull };
}
// ~/~ end
