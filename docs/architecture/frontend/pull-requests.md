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

One pull request, head by head. The before end defaults to the base and the
after end to the latest head, so a pull request opens on what it introduces
against the branch it targets. That is the question a reviewer asks on
opening a pull request, and it replaces a defect the old default had: a pull
request with only one version used to compare that version against itself
and show an empty diff, because the before end also defaulted to a head.

The before end is a `PullBaseline` rather than a head, which is what the
[diff route](../backend/server.md) takes. The picker below hands one back
directly, so this controller passes what it is given straight through
instead of converting a head into a baseline itself.

```tsx
//| id: frontend-controller-pull-review
//| file: src/frontend/controllers/PullReview.tsx
import { useState } from "react";
import type { GitOid, PullBaseline, PullSummary } from "../api";
import { usePullHistory } from "../state/pullHistory";
import type { Session } from "../state/session";
import { Message } from "../views/Message";
import { PullComparisonPicker } from "../views/PullComparisonPicker";
import { PullHeader } from "../views/PullHeader";
import { PullReviewPanes } from "../views/PullPanes";
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
  const [from, setFrom] = useState<PullBaseline>({ kind: "base" });
  const [pickedTo, setPickedTo] = useState<GitOid | null>(null);

  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  const latest = history.data.states.at(-1);
  if (latest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }

  const to = pickedTo ?? latest.head;
  const number = pull.number;

  return (
    <PullReviewPanes
      header={<PullHeader pull={pull} />}
      picker={
        <PullComparisonPicker
          history={history.data}
          from={from}
          to={to}
          onPickFrom={setFrom}
          onPickTo={setPickedTo}
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

A title is how a pull request is told from the others in the list, and the
part that tells them apart is rarely in the first thirty characters. On a
narrow screen it wraps onto as many lines as it needs.

```css
/*| id: design-pull-list
@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-list__title {
      white-space: normal;
      overflow: visible;
    }
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

One line is what a desk has the width for. A phone does not, so the strip
wraps and the title, the longest string on it, takes a row of its own above
the small facts. That spends height, which a phone has, to stop spending
width, which it has not.

```css
/*| id: design-pull-header
@layer components-narrow {
  @media (max-width: 1000px) {
    .pull-header {
      flex-wrap: wrap;
      row-gap: var(--space-2);
      white-space: normal;
      overflow: visible;
    }

    .pull-header__title {
      flex-basis: 100%;
      overflow: visible;
    }
  }
}
```

## Pull comparison picker

Two native `<select>`s, one per end of the comparison, each wrapped in a
`<label>` with a visible text caption. [`OperationPicker`](local-history.md)
is the only other place in the app that reaches for a native select, and this
follows its shape: a label naming the field, a select whose `value` is looked
up rather than trusted, and `onChange` turning the chosen option back into a
real value before it leaves the component.

A native select is the right control for a phone as well as a desktop. A
touch browser renders it as a full-screen list a reader taps through, and it
is keyboard- and screen-reader-complete with no work of its own.

The "from" select offers the base branch tip alongside every version; the
"to" select offers versions only. The base as the after end is the pull
request read backwards, which nobody reads, and the commit strip beside the
diff takes `to` as a head with nothing to draw for a base. That asymmetry is
why the component takes `from: PullBaseline` and `to: GitOid` rather than a
matched pair.

Each option is one line: `base (main @ a1b2c3d)` for the base, and
`v3 (c3d4e5f, force-pushed 2024-05-01)` for a version, built from its
position in the chain, its short oid, and how it became the head. A version
option is never picked by casting `event.target.value`, a DOM string, to a
`GitOid`. It is looked up in `history.states` instead, and the branded oid
that was already there is handed back; a value matching nothing is a bug,
and it throws rather than inventing an oid.

`PullHistory.truncated` is true when the branch was force-pushed more times
than one page of GitHub's history holds, so the middle of the chain is
missing and the version numbers this component labels options with are
positions among the states that survived, not actual push counts. A dropdown
hides that gap worse than a row of chips would have, since a collapsed list
gives no visual hint that anything is missing, so a short note says a gap
exists. GitHub's own history does not say where the gap is, only that there
is one, so the note does not try to mark it between two options either.

The caption matters more here than the chip row's caption did, because the
two selects name which versions are being compared but not which kind of
comparison is on screen. Base against a head is a tree diff of content;
version against version is a diff of diffs. Those answer different
questions, and [the backend route](../backend/server.md) refused to offer a
second comparison here for exactly as long as it would have gone unlabelled.
The caption is what discharges that objection, so it is load-bearing rather
than decoration.

```tsx
//| id: frontend-view-pull-comparison-picker
//| file: src/frontend/views/PullComparisonPicker.tsx
import type {
  GitOid,
  PullBaseline,
  PullHeadOrigin,
  PullHistory,
  PullVersion,
} from "../api";

export function PullComparisonPicker({
  history,
  from,
  to,
  onPickFrom,
  onPickTo,
}: {
  history: PullHistory;
  from: PullBaseline;
  to: GitOid;
  onPickFrom: (from: PullBaseline) => void;
  onPickTo: (head: GitOid) => void;
}) {
  const { states, baseRefName, baseRefOid, truncated } = history;

  return (
    <div className="pull-compare">
      <label className="pull-compare__field">
        <span className="pull-compare__label">from</span>
        <select
          value={from.kind === "base" ? "base" : from.head}
          onChange={(event) =>
            onPickFrom(parseBaseline(event.target.value, states))
          }
          className="pull-compare__select"
        >
          <option value="base">{`base (${baseRefName} @ ${baseRefOid.slice(0, 7)})`}</option>
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      <label className="pull-compare__field">
        <span className="pull-compare__label">to</span>
        <select
          value={to}
          onChange={(event) => onPickTo(lookupHead(event.target.value, states))}
          className="pull-compare__select"
        >
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      {truncated ? (
        <p className="pull-compare__truncated">
          Some versions are missing here. This pull request was force-pushed
          more times than GitHub's history holds, and it does not say which ones
          were lost.
        </p>
      ) : null}
      <p className="pull-compare__caption">
        {caption(states, baseRefName, from, to)}
      </p>
    </div>
  );
}

function parseBaseline(value: string, states: PullVersion[]): PullBaseline {
  if (value === "base") return { kind: "base" };
  return { kind: "version", head: lookupHead(value, states) };
}

function lookupHead(value: string, states: PullVersion[]): GitOid {
  const state = states.find((candidate) => candidate.head === value);
  if (state === undefined) {
    throw new Error(`no version of this pull request has head ${value}`);
  }
  return state.head;
}

function versionLabel(state: PullVersion): string {
  return `v${state.version} (${state.head.slice(0, 7)}, ${when(state.origin)})`;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") {
    return `force-pushed ${origin.at.slice(0, 10)}`;
  }
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(
  states: PullVersion[],
  baseRefName: string,
  from: PullBaseline,
  to: GitOid,
): string {
  if (from.kind === "base") {
    return `what ${label(states, to)} adds to ${baseRefName}`;
  }
  if (from.head === to) {
    return `${label(states, to)} against itself`;
  }
  return `what changed between ${label(states, from.head)} and ${label(states, to)}`;
}
```

A reader loses something real here. A row of chips names both ends of the
whole force-push history at a glance; two dropdowns hide that history behind
a list a reader has to open and count through. The change is made anyway,
because a picker a phone cannot operate is not a picker. Shift-click has no
touch equivalent, so a reader on a phone could move the after end and never
the before end, which is a control that only half works for part of its
audience.

`PullComparisonPicker` is two labelled selects and two caption lines, so
`.pull-compare` is the flex row that holds all four and the rest of the
classes only line each part up. `flex-wrap: wrap` on that row is what lets
the two fields sit side by side on a wide screen and drop to a stack on a
phone, and `min-height: 44px` on the select is the standard minimum touch
target size (WCAG 2.5.5), which a desktop pointer never notices. `min-width:
0` on the field and the select keeps a long option label from forcing the
row wider than its column, the same problem a text-overflow ellipsis solves
elsewhere in this app.

```css
/*| id: design-pull-comparison-picker
@layer components {
  .pull-compare {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .pull-compare__field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .pull-compare__label {
    color: var(--text-faint);
  }

  .pull-compare__select {
    min-height: 44px;
    min-width: 0;
    font: inherit;
  }

  .pull-compare__caption {
    flex: 1 0 100%;
    margin: 0;
    color: var(--text-faint);
  }

  .pull-compare__truncated {
    flex: 1 0 100%;
    margin: 0;
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
