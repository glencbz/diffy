# Pull requests

The screen that reviews a history nobody has locally, where a side is pinned
to one of the heads the branch has had.

## Loading the list and one pull's heads

`usePulls` loads the repository's pull requests in every state. A merged pull
request that was force-pushed on the way is exactly the history worth reading
back, and a list of open ones would never reach it.

```tsx
//| id: frontend-state-pulls
//| file: src/frontend/state/pulls.ts
import { useEffect, useState } from "react";
import { fetchPulls, type PullSummary } from "../api";
import type { AsyncState } from "./asyncState";

export function usePulls(repo: string): AsyncState<PullSummary[]> {
  const [state, setState] = useState<AsyncState<PullSummary[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPulls(repo, "all")
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo]);

  return state;
}
```

`usePullHistory` loads one pull request's chain of heads. Everything the review
pane shows below the header depends on it, down to which head counts as the
latest, so it loads first and on its own.

```tsx
//| id: frontend-state-pull-history
//| file: src/frontend/state/pullHistory.ts
import { useEffect, useState } from "react";
import { fetchPullHistory, type PullHistory } from "../api";
import type { AsyncState } from "./asyncState";

export function usePullHistory(
  repo: string,
  number: number,
): AsyncState<PullHistory> {
  const [state, setState] = useState<AsyncState<PullHistory>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchPullHistory(repo, number)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [repo, number]);

  return state;
}
```
## Pull requests controller

The list, and whichever pull request is picked out of it. The selected number
lives here rather than in `App` because the list is the only other thing that
reads it, and the summary it selects is what the header needs.

`PullReview` is keyed by the pull request number, so picking a different one
remounts it and the two ends of the comparison start again at "the first head
against the latest". Clearing them by hand would be the same behaviour written
out, with a way to forget a field.

```tsx
//| id: frontend-controller-pull-requests
//| file: src/frontend/controllers/PullRequests.tsx
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
```

## Pull review controller

One pull request, head by head. The two ends of the comparison live here: the
after end defaults to the latest head and the before end to the first, so a
pull request opens on the interdiff across its whole force-push history, v1
to latest, and a shift-click narrows it to what changed since one particular
head.

The before end is a `PullBaseline` rather than a head, which is what the
[diff route](../backend/server.md) takes. The timeline offers heads and
nothing else, so every baseline this controller holds is a version and the
screen shows what it showed before. The conversion happens where this
controller reads and writes that state, which leaves the timeline a view of
heads.

```tsx
//| id: frontend-controller-pull-review
//| file: src/frontend/controllers/PullReview.tsx
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
```

## Pull request list

One row per pull request: its number, its state, its title, and the branch it
targets. The base branch is there because a pull request against a release
branch and one against `main` read differently, and the number alone does not
say which this is.

```tsx
//| id: frontend-view-pull-list
//| file: src/frontend/views/PullList.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullList({
  pulls,
  selected,
  onSelect,
}: {
  pulls: PullSummary[];
  selected: number | null;
  onSelect: (number: number) => void;
}) {
  return (
    <div>
      {pulls.map((pull) => (
        <button
          type="button"
          key={pull.number}
          onClick={() => onSelect(pull.number)}
          className={
            pull.number === selected
              ? "pull-list__item pull-list__item--selected"
              : "pull-list__item"
          }
        >
          <span className="pull-list__row">
            <span className="pull-list__number">#{pull.number}</span>
            <PullStateChip state={pull.state} />
          </span>
          <span className="pull-list__title">{pull.title}</span>
          <span className="pull-list__base">← {pull.baseRefName}</span>
        </button>
      ))}
    </div>
  );
}
```

PullList renders each pull request as a full-width button standing in for
a row, and the selected one takes the same selection colour a picked commit
gets in the graph.

```css
/*| id: design-pull-list
@layer components {
  .pull-list__item {
    display: block;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
  }

  .pull-list__item--selected {
    background: var(--surface-selected);
  }

  .pull-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .pull-list__number {
    color: var(--text-faint);
  }

  .pull-list__title {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pull-list__base {
    color: var(--text-faint);
  }
}
```

## Pull request header

What is being read, on one line, including a link out to GitHub. The link is
there because half of reviewing a pull request is the conversation on it, and
this tool does not show conversations.

```tsx
//| id: frontend-view-pull-header
//| file: src/frontend/views/PullHeader.tsx
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullHeader({ pull }: { pull: PullSummary }) {
  return (
    <header className="pull-header">
      <span className="pull-header__meta">#{pull.number}</span>
      <strong className="pull-header__title">{pull.title}</strong>
      <PullStateChip state={pull.state} />
      <span className="pull-header__meta">base: {pull.baseRefName}</span>
      <span className="pull-header__meta">{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        className="pull-header__link"
      >
        github
      </a>
    </header>
  );
}
```

PullHeader is a strip of small facts about a pull request, and the number,
the base branch, and the author share one muted style since none of them
outranks the others.

```css
/*| id: design-pull-header
@layer components {
  .pull-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-3) var(--space-5);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
  }

  .pull-header__title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pull-header__meta {
    color: var(--text-faint);
  }

  .pull-header__link {
    color: var(--accent);
  }
}
```

## Pull request timeline

Every head the branch has had, oldest first, on one line. Both ends of the
comparison are marked on that line at the same time: the after end in blue, the
before end in amber. A dropdown per end would show one choice each and neither
in the context of the other.

A click moves the after end and a shift-click moves the before end. Shift-click
is not discoverable, so the hint next to the chips says so in words rather than
leaving a reader to find it.

A chip shows its version label, the short oid, and when the force push that
made it happened. The label is for the reader, and everything that asks the
backend for a state passes the oid.

Both ends can land on the same head, and the caption names which way it
happened rather than reading like a typo, "comparing v1 → v1". A pull
request nobody has force-pushed has one head and nothing yet to compare. A
reviewer who picks one chip twice on a longer timeline has asked a question
with an empty answer, which is a different thing to be told.

```tsx
//| id: frontend-view-pull-timeline
//| file: src/frontend/views/PullTimeline.tsx
import type { GitOid, PullHeadOrigin, PullVersion } from "../api";

type Endpoint = "before" | "after";

export function PullTimeline({
  states,
  before,
  after,
  onPick,
}: {
  states: PullVersion[];
  before: GitOid;
  after: GitOid;
  onPick: (head: GitOid, end: "before" | "after") => void;
}) {
  return (
    <div className="pull-timeline">
      <div className="pull-timeline__row">
        {states.map((state) => (
          <Chip
            key={state.head}
            caption={`v${state.version}`}
            detail={`${state.head.slice(0, 7)}  ${when(state.origin)}`}
            endpoint={endpointFor(state.head, before, after)}
            onClick={(shift) => onPick(state.head, shift ? "before" : "after")}
          />
        ))}
      </div>
      <p className="pull-timeline__caption">
        {caption(states, before, after)} · click sets the after end, shift-click
        sets the before end
      </p>
    </div>
  );
}

/** The after end wins when one chip is both, since it is the one being read. */
function endpointFor(
  head: GitOid,
  before: GitOid,
  after: GitOid,
): Endpoint | null {
  if (head === after) return "after";
  if (head === before) return "before";
  return null;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") return origin.at.slice(0, 10);
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(states: PullVersion[], before: GitOid, after: GitOid): string {
  if (before !== after) {
    return `comparing ${label(states, before)} → ${label(states, after)}`;
  }
  return states.length === 1
    ? `${label(states, after)} is the only version so far`
    : `${label(states, after)} against itself`;
}

function Chip({
  caption,
  detail,
  endpoint,
  onClick,
}: {
  caption: string;
  detail: string;
  endpoint: Endpoint | null;
  onClick: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.shiftKey)}
      className={
        endpoint === null ? "pull-chip" : `pull-chip pull-chip--${endpoint}`
      }
    >
      <span className="pull-chip__caption">{caption}</span>
      <span className="pull-chip__detail">{detail}</span>
    </button>
  );
}
```

A version chip on the timeline is picked as the before end, the after end,
or neither, which is a fixed set of three and becomes a modifier rather
than a colour computed in the component. `--endpoint-before` is the one new
role this adds; the after end reuses `--accent`, the same blue used for the
current selection everywhere else in the app.

```css
/*| id: design-pull-timeline
@layer components {
  .pull-timeline {
    flex: none;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .pull-timeline__row {
    display: flex;
    align-items: stretch;
    gap: var(--space-3);
    overflow-x: auto;
  }

  .pull-timeline__caption {
    margin: var(--space-3) 0 0;
    color: var(--text-faint);
  }

  .pull-chip {
    flex: none;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
    text-align: left;
    color: inherit;
    background: var(--surface);
  }

  .pull-chip--before {
    border-color: var(--endpoint-before);
    color: var(--endpoint-before);
    background: var(--review-unseen-surface);
  }

  .pull-chip--after {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--review-unseen-surface);
  }

  .pull-chip__caption {
    display: block;
    font-weight: bold;
  }

  .pull-chip__detail {
    display: block;
    color: var(--text-faint);
    font-size: var(--text-size-small);
  }
}
```

## Pull request state chip

A pull request is open, merged or closed, and a reader scanning a list should
tell which at a glance rather than by reading the word. One component, so the
list and the header colour them the same.

```tsx
//| id: frontend-view-pull-state-chip
//| file: src/frontend/views/PullStateChip.tsx
import type { PullState } from "../api";

const CHIP_CLASS: Record<PullState, string> = {
  OPEN: "chip--open",
  MERGED: "chip--merged",
  CLOSED: "chip--closed",
};

export function PullStateChip({ state }: { state: PullState }) {
  return (
    <span className={`chip ${CHIP_CLASS[state]}`}>{state.toLowerCase()}</span>
  );
}
```

Three states and nothing else, so the chip is `.chip` plus one modifier each
rather than a colour keyed by string. `--state-open`, `--state-merged`, and
`--state-closed` are the only place those three colours are written down.

```css
/*| id: design-pull-state-chip
@layer components {
  .chip {
    flex: none;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    color: var(--text-inverse);
    font-size: var(--text-size-small);
  }

  .chip--open {
    background: var(--state-open);
  }

  .chip--merged {
    background: var(--state-merged);
  }

  .chip--closed {
    background: var(--state-closed);
  }
}
```
