# Local reviews

A local review is a series registered as ready for review, by an agent
through the server's route or by a reader ticking it in the
[local history](local-history.md) graph; each registration is a version. The [direction](../../direction.md#a-local-review-is-registered)
says why a review is registered rather than read off every bookmark.

## The screen

```tsx
//| id: frontend-screen-local-reviews
//| file: src/frontend/screens/LocalReviewsScreen.tsx
import { LocalReviews } from "../controllers/LocalReviews";
import { type LocalPlace, type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function LocalReviewsScreen({
  place,
  onGo,
}: {
  place: LocalPlace | null;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode="reviews"
        onSelect={(mode) => {
          if (mode !== "reviews") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      <LocalReviews
        place={place}
        review={review}
        onGo={(local, visit) => onGo({ tab: "reviews", review: local }, visit)}
      />
    </div>
  );
}
```

## Local reviews controller

The list is the review document's `localReviews`, so it needs no load of its
own, and a review an agent registers appears on an open screen as soon as the
server announces the change. Each entry draws its newest version's commits
as a graph, since a name and a revset do not say which commits they are.

A picked review reads in the
[series review screen](pull-requests.md#series-review-controller), and
`LocalReviewScreen` fills in what differs. A row is filed by
[`localRowKey`](review.md#review-state) under its change id, which survives
the rewrites between one registration and the next.

The panes are the pull request screen's. The rail returns to the list rather
than opening it over the review as the pull request screen's sheet does,
since a phone has no room for both.

Forgetting a review returns to the list when the review was the open one,
which would otherwise read as not found. It asks nothing first: the review
waits under the list to be restored until the server purges it.

```tsx
//| id: frontend-controller-local-reviews
//| file: src/frontend/controllers/LocalReviews.tsx
import { type LocalPlace, localHref, openLocal } from "../model/place";
import {
  type LocalReview,
  localReview,
  localRowKey,
  localSeries,
} from "../model/review";
import { localHistory } from "../model/series";
import type { Visit } from "../state/place";
import type { ReviewHandle } from "../state/review";
import { LocalReviewList } from "../views/LocalReviewList";
import { Message } from "../views/Message";
import { CommitLog } from "./CommitLog";
import { SeriesReview, type SeriesScreen } from "./SeriesReview";

export function LocalReviews({
  place,
  review,
  onGo,
}: {
  place: LocalPlace | null;
  review: ReviewHandle;
  onGo: (place: LocalPlace | null, visit?: Visit) => void;
}) {
  if (review.status === "loading") {
    return <Message>Loading local reviews...</Message>;
  }

  const reviews = review.document.localReviews.filter(
    (local) => local.forgottenAt === undefined,
  );
  const forgotten = review.document.localReviews.filter(
    (local) => local.forgottenAt !== undefined,
  );
  const found =
    place === null ? undefined : localReview(review.document, place.name);
  const open = found?.forgottenAt === undefined ? found : undefined;

  return (
    <div
      className={`panes panes--${open === undefined ? "browsing" : "reviewing"}`}
    >
      {open !== undefined && (
        <button
          type="button"
          aria-label="show the local review list"
          onClick={() => onGo(null)}
          className="pull-rail"
        >
          local reviews
        </button>
      )}
      <div className="pane pane--list">
        <LocalReviewList
          reviews={reviews}
          forgotten={forgotten}
          selected={open?.name ?? null}
          onSelect={(name) =>
            onGo(name === place?.name ? place : openLocal(name))
          }
          onForget={
            review.status === "ready"
              ? (name) => {
                  review.actions.forgetReview(name);
                  if (name === place?.name) onGo(null);
                }
              : null
          }
          onRestore={
            review.status === "ready" ? review.actions.restoreReview : null
          }
          commits={(version) => (
            <CommitLog
              source={{ kind: "local", commits: version.commits }}
              selected={[]}
            />
          )}
        />
      </div>
      <div className="pane pane--main">
        {open === undefined || place === null ? (
          <Message>
            {reviews.length === 0
              ? "Nothing is registered for review yet. Tick its commits in Operations and press review."
              : "Select a local review to read it."}
          </Message>
        ) : (
          <LocalReviewScreen
            key={open.name}
            local={open}
            place={place}
            review={review}
            onGo={onGo}
          />
        )}
      </div>
    </div>
  );
}

function LocalReviewScreen({
  local,
  place,
  review,
  onGo,
}: {
  local: LocalReview;
  place: LocalPlace;
  review: ReviewHandle;
  onGo: (place: LocalPlace, visit?: Visit) => void;
}) {
  const { name } = local;
  const screen: SeriesScreen = {
    source: { kind: "local", review: local },
    series: localSeries(name),
    history: localHistory(local),
    header: (
      <header className="pull-header">
        <strong className="pull-header__title">{name}</strong>
        <span className="pull-header__meta">
          {local.versions.at(-1)?.revset}
        </span>
      </header>
    ),
    wholeLabel: "whole review",
    keyOf: (_document, before, after) => localRowKey(before, after),
    lane: (id) => ({
      kind: "local",
      commits: local.versions[Number(id) - 1]?.commits ?? [],
    }),
  };

  return (
    <SeriesReview
      screen={screen}
      place={place}
      review={review}
      onGo={(next, visit) => onGo({ ...next, name }, visit)}
      href={(next) => localHref({ ...next, name })}
    />
  );
}
```

## The list

An entry is its name, how many versions it has, and the newest version's
revset over that version's commits. The graph comes in through `commits`,
since loading commits is a controller's job and the list is a view. The
graph picks nothing, so a click anywhere on the entry opens the review.
`delete` sits beside the name. Forgotten reviews wait under the list with
`restore` in its place. Both buttons are left out while the review document
cannot be written.

```tsx
//| id: frontend-view-local-review-list
//| file: src/frontend/views/LocalReviewList.tsx
import type { ReactNode } from "react";
import type { LocalReview, LocalVersion } from "../model/review";

export function LocalReviewList({
  reviews,
  forgotten,
  selected,
  onSelect,
  onForget,
  onRestore,
  commits,
}: {
  reviews: LocalReview[];
  forgotten: LocalReview[];
  selected: string | null;
  onSelect: (name: string) => void;
  onForget: ((name: string) => void) | null;
  onRestore: ((name: string) => void) | null;
  /** The graph of one version's commits. */
  commits: (version: LocalVersion) => ReactNode;
}) {
  return (
    <div>
      {reviews.map((review) => {
        const newest = review.versions.at(-1);
        return (
          <div
            key={review.name}
            className={
              review.name === selected
                ? "pull-list__item pull-list__item--selected local-review"
                : "pull-list__item local-review"
            }
          >
            <div className="local-review__head">
              <button
                type="button"
                onClick={() => onSelect(review.name)}
                className="local-review__open"
              >
                <span className="pull-list__row">
                  <span className="pull-list__number">
                    v{review.versions.length}
                  </span>
                  <span className="pull-list__title">{review.name}</span>
                </span>
                {newest !== undefined && (
                  <span className="pull-list__base">{newest.revset}</span>
                )}
              </button>
              {onForget !== null && (
                <button
                  type="button"
                  aria-label={`forget the local review ${review.name}`}
                  onClick={() => onForget(review.name)}
                  className="local-review__action local-review__action--danger"
                >
                  delete
                </button>
              )}
            </div>
            {newest !== undefined && (
              // biome-ignore lint/a11y/noStaticElementInteractions: the button above opens the same review for keyboards
              // biome-ignore lint/a11y/useKeyWithClickEvents: the button above opens the same review for keyboards
              <div
                onClick={() => onSelect(review.name)}
                className="local-review__commits"
              >
                {commits(newest)}
              </div>
            )}
          </div>
        );
      })}
      {forgotten.length > 0 && (
        <>
          <div className="local-review__deleted">recently deleted</div>
          {forgotten.map((review) => (
            <div
              key={review.name}
              className="pull-list__item local-review local-review--forgotten"
            >
              <div className="local-review__head">
                <span className="local-review__label">
                  <span className="pull-list__title">{review.name}</span>
                  <span className="pull-list__base">
                    {review.versions.at(-1)?.revset}
                  </span>
                </span>
                {onRestore !== null && (
                  <button
                    type="button"
                    aria-label={`restore the local review ${review.name}`}
                    onClick={() => onRestore(review.name)}
                    className="local-review__action"
                  >
                    restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

The entry keeps the list's item styling; the button inside it fills the row
like the item it replaces, and the graph sits flush beneath it. The entry is
a `div` where the pull request list's item is a `button`, so it sets the
border-box sizing a button has by default, or its padding pushes `delete` past
the pane's edge. `delete` and `restore` are quiet until hovered, styled like
the picker row's buttons, and a forgotten entry is drawn faint and opens
nothing.

```css
/*| id: design-local-review-list
@layer components {
  .local-review {
    box-sizing: border-box;
  }

  .local-review__head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .local-review__open {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .local-review--forgotten {
    color: var(--text-faint);
    cursor: default;
  }

  .local-review__label {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .local-review__deleted {
    padding: var(--space-4) var(--space-4) var(--space-2);
    color: var(--text-faint);
    border-bottom: 1px solid var(--border-subtle);
  }

  .local-review__action {
    flex: none;
    padding: var(--space-1) var(--space-4);
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .local-review__action:hover {
    color: var(--text);
    border-color: var(--text-faint);
  }

  .local-review__action--danger:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .local-review__commits {
    margin-top: var(--space-3);
    cursor: pointer;
  }
}
```

## Registering from the graph

A reader registers a review where its commits are drawn: `review` on the
local history picker row opens a strip over the graph, and the ticked
commits are what it registers. A form with only a name and a revset asks the
reader to know which commits a revset names before they can see them.

The strip keeps the ticks and a revset in step both ways. Ticking writes the
revset `revsetFor` derives, and typing one ticks what the server says it
names, so the graph shows the commits either way and the diff beside it
shows what they change. A tick after typing hands the revset back to the
ticks. Commits the revset names outside the drawn log are counted, since
they cannot be ticked.

The version is read at the operation the graph shows, which is not always
the newest. Registering at the newest instead could name other commits than
the ones on screen, and refusing an older one would send the reader to pick
the newest before they could register what they were looking at.

### Revsets from ticks

`revsetFor` names the ticks in the shortest form that says the same thing.
A stack from trunk to a bookmark is `trunk()..<bookmark>`, so the next
version of the review takes in commits added to it; a run between two
commits is `<oldest>::<newest>`; anything else lists the commits. It decides
from the drawn log alone, which holds every commit those forms reach when
the ticks are in it. A commit is named by its bookmark when it has a local
one, quoted as the server quotes it, and otherwise by its change id, or its
commit id when the change is divergent and the change id names more than
one commit.

Which commit `trunk()` is comes from the server, since jj resolves it from
remote bookmarks and the log prints a remote one only once it drifts from
the local one. With no answer yet, the stack form is skipped rather than
guessed.

```ts
//| id: frontend-model-revset
//| file: src/frontend/model/revset.ts
import type { LogEntry } from "./history";

function localBookmark(commit: LogEntry): string | undefined {
  return commit.refs.find(
    (ref) => ref.kind === "bookmark" && !ref.name.includes("@"),
  )?.name;
}

/** How a revset names `commit`. */
function symbol(commit: LogEntry): string {
  const bookmark = localBookmark(commit);
  if (bookmark !== undefined) return JSON.stringify(bookmark);
  if (commit.changeId === null || commit.markers.includes("divergent")) {
    return commit.commitId.slice(0, 12);
  }
  return commit.changeId.slice(0, 12);
}

/** The commits of `log` that `from` reaches through parents, itself
 *  included. */
function ancestors(log: Map<string, LogEntry>, from: string): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const commit = log.get(id);
    if (commit === undefined || seen.has(id)) continue;
    seen.add(id);
    stack.push(...commit.parents);
  }
  return seen;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** A revset naming exactly the commits `ticked` holds, or "" for none.
 *  `trunk` is the commit id `trunk()` names, if known. */
export function revsetFor(
  log: LogEntry[],
  ticked: string[],
  trunk: string | null,
): string {
  const byId = new Map(log.map((commit) => [commit.commitId, commit]));
  const chosen = new Set(ticked.filter((id) => byId.has(id)));
  const picked = log.filter((commit) => chosen.has(commit.commitId));
  if (picked.length === 0) return "";

  const parentsOf = (commit: LogEntry) =>
    commit.parents.filter((id) => chosen.has(id));
  const heads = picked.filter(
    (commit) =>
      !picked.some((other) => parentsOf(other).includes(commit.commitId)),
  );
  const roots = picked.filter((commit) => parentsOf(commit).length === 0);
  const [head] = heads;

  if (heads.length === 1 && head !== undefined) {
    const reach = ancestors(byId, head.commitId);
    if (trunk !== null && !chosen.has(trunk)) {
      const below = ancestors(byId, trunk);
      const stack = new Set([...reach].filter((id) => !below.has(id)));
      if (sameSet(stack, chosen)) return `trunk()..${symbol(head)}`;
    }

    const [root] = roots;
    if (roots.length === 1 && root !== undefined) {
      const run = new Set(
        [...reach].filter((id) => ancestors(byId, id).has(root.commitId)),
      );
      if (sameSet(run, chosen)) {
        return root === head
          ? symbol(head)
          : `${symbol(root)}::${symbol(head)}`;
      }
    }
  }

  return picked.map(symbol).join(" | ");
}

/** What to call a review of `ticked` until the reader says: the one head's
 *  bookmark, else its change id, else nothing. */
export function reviewNameFor(log: LogEntry[], ticked: string[]): string {
  const chosen = new Set(ticked);
  const picked = log.filter((commit) => chosen.has(commit.commitId));
  const heads = picked.filter(
    (commit) =>
      !picked.some((other) => other.parents.includes(commit.commitId)),
  );
  const [head] = heads;
  if (heads.length !== 1 || head === undefined) return "";
  return localBookmark(head) ?? head.changeId?.slice(0, 8) ?? "";
}
```

```ts
//| id: frontend-model-revset-test
//| file: src/frontend/model/revset.test.ts
import { describe, expect, test } from "bun:test";
import type { CommitRef, LogEntry } from "./history";
import { reviewNameFor, revsetFor } from "./revset";

function commit(
  id: string,
  parents: string[],
  bookmarks: string[] = [],
): LogEntry {
  return {
    commitId: `${id}-commit`,
    changeId: `${id}-change-id`,
    description: id,
    parents: parents.map((parent) => `${parent}-commit`),
    author: "someone@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    refs: bookmarks.map((name): CommitRef => ({ kind: "bookmark", name })),
    markers: [],
  };
}

// c <- b <- a <- main <- root, and a side branch s off main
const LOG = [
  commit("c", ["b"], ["feature"]),
  commit("b", ["a"]),
  commit("s", ["main"]),
  commit("a", ["main"]),
  commit("main", ["root"], ["main"]),
  commit("root", []),
];
const ids = (...names: string[]) => names.map((name) => `${name}-commit`);
const TRUNK = "main-commit";

describe("revsetFor", () => {
  test("names a stack on trunk by its bookmark", () => {
    expect(revsetFor(LOG, ids("c", "b", "a"), TRUNK)).toBe(
      'trunk().."feature"',
    );
  });

  test("names a run that stops short of trunk by its ends", () => {
    expect(revsetFor(LOG, ids("c", "b"), TRUNK)).toBe('b-change-id::"feature"');
  });

  test("names one commit on its own", () => {
    expect(revsetFor(LOG, ids("b"), TRUNK)).toBe("b-change-id");
  });

  test("lists commits that are not one run", () => {
    expect(revsetFor(LOG, ids("c", "s"), TRUNK)).toBe(
      '"feature" | s-change-id',
    );
  });

  test("reads trunk as the server named it, not off a bookmark", () => {
    expect(revsetFor(LOG, ids("a", "main"), "root-commit")).toBe(
      "trunk()..a-change-id",
    );
    expect(revsetFor(LOG, ids("a"), "root-commit")).toBe("a-change-id");
  });

  test("names the run by its ends while trunk is unknown", () => {
    expect(revsetFor(LOG, ids("c", "b", "a"), null)).toBe(
      'a-change-id::"feature"',
    );
  });

  test("names nothing for no ticks", () => {
    expect(revsetFor(LOG, [], TRUNK)).toBe("");
  });
});

describe("reviewNameFor", () => {
  test("takes the one head's bookmark", () => {
    expect(reviewNameFor(LOG, ids("c", "b"))).toBe("feature");
  });

  test("falls back to the head's change id", () => {
    expect(reviewNameFor(LOG, ids("b", "a"))).toBe("b-change");
  });

  test("leaves a series with two heads unnamed", () => {
    expect(reviewNameFor(LOG, ids("c", "s"))).toBe("");
  });
});
```

### The toggle

`review` counts the ticks, so the reader sees what the strip will start from
before opening it. It opens with nothing ticked too, for a reader who would
rather type a revset.

```tsx
//| id: frontend-view-review-toggle
//| file: src/frontend/views/ReviewToggle.tsx
export function ReviewToggle({
  open,
  ticked,
  onToggle,
}: {
  open: boolean;
  ticked: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={open ? "review-toggle review-toggle--open" : "review-toggle"}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={
        open
          ? "close the review strip"
          : "register the ticked commits as a local review"
      }
    >
      {ticked === 0 ? "review" : `review ${ticked}`}
    </button>
  );
}
```

```css
/*| id: design-register-strip
@layer components {
  .review-toggle {
    flex: none;
    height: 2em;
    padding: 0 var(--space-4);
    font: inherit;
    color: var(--surface);
    white-space: nowrap;
    cursor: pointer;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }

  .review-toggle--open {
    color: var(--accent);
    background: var(--surface-selected);
  }
}
```

### Loading and registering

`useRevsetMatch` asks the server what a typed revset names at the graph's
operation, a moment after the reader stops typing, so each keystroke does not
run `jj log`. It answers null while nothing is typed. `useTrunk` asks the
same route for `trunk()`. `register` is the
transport call, here so the controller does not reach past `state/`.

```ts
//| id: frontend-state-registration
//| file: src/frontend/state/registration.ts
import { useEffect, useState } from "react";
import { fetchLog, registerLocalReview } from "../api";
import type { AsyncState } from "../model/asyncState";

const SETTLE_MS = 300;

/** The commit ids `revset` names at `operation`, or null with no revset. */
export function useRevsetMatch(
  operation: string,
  revset: string | null,
): AsyncState<string[]> | null {
  const [match, setMatch] = useState<AsyncState<string[]> | null>(null);

  useEffect(() => {
    if (revset === null || revset.trim() === "") {
      setMatch(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setMatch({ status: "loading" });
      fetchLog(operation, revset).then(
        (log) =>
          live &&
          setMatch({
            status: "ready",
            data: log.map((commit) => commit.commitId),
          }),
        (err: unknown) =>
          live &&
          setMatch({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [operation, revset]);

  return match;
}

/** The commit id `trunk()` names at `operation`, or null until it is known
 *  or if jj will not say. Either way the strip can still name the ticks. */
export function useTrunk(operation: string): string | null {
  const [trunk, setTrunk] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setTrunk(null);
    fetchLog(operation, "trunk()").then(
      ([commit]) => live && setTrunk(commit?.commitId ?? null),
      () => live && setTrunk(null),
    );
    return () => {
      live = false;
    };
  }, [operation]);

  return trunk;
}

export const register = registerLocalReview;
```

### The strip

`RegisterReview` holds what the reader typed and what the server last
answered. The button says what registering will do to the review the name
already belongs to: start it, add a version, or replace the version already
read at this operation, which is what the server does with a second one
there.

```tsx
//| id: frontend-controller-register-review
//| file: src/frontend/controllers/RegisterReview.tsx
import { useEffect, useRef, useState } from "react";
import { localReview } from "../model/review";
import { reviewNameFor, revsetFor } from "../model/revset";
import { useCommits } from "../state/commits";
import { register, useRevsetMatch, useTrunk } from "../state/registration";
import { useReviewContext } from "../state/review";
import { RegisterStrip } from "../views/RegisterStrip";

export function RegisterReview({
  operation,
  ticked,
  onTick,
  onOpen,
  onClose,
}: {
  operation: string;
  ticked: string[];
  onTick: (commitIds: string[]) => void;
  onOpen: (name: string) => void;
  onClose: () => void;
}) {
  const log = useCommits({ kind: "jj", operation });
  const review = useReviewContext();
  const [typed, setTyped] = useState<string | null>(null);
  const [named, setNamed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const match = useRevsetMatch(operation, typed);
  const trunk = useTrunk(operation);
  const applied = useRef<string[] | null>(null);

  const entries = log.status === "ready" ? log.data : [];
  const matched = match?.status === "ready" ? new Set(match.data) : null;
  const inGraph =
    matched === null
      ? []
      : entries
          .filter((commit) => matched.has(commit.commitId))
          .map((commit) => commit.commitId);

  // A typed revset's answer ticks what it names.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new answer re-ticks
  useEffect(() => {
    if (matched === null) return;
    applied.current = inGraph;
    onTick(inGraph);
  }, [match]);

  // A tick the reader made hands the revset back to the ticks.
  useEffect(() => {
    const ours = applied.current;
    if (ours === null) return;
    if (
      ours.length === ticked.length &&
      ours.every((id, i) => id === ticked[i])
    ) {
      return;
    }
    applied.current = null;
    setTyped(null);
  }, [ticked]);

  // What was registered stops describing the strip once the series moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to either clears it
  useEffect(() => setRegistered(null), [ticked, operation]);

  const revset = typed ?? revsetFor(entries, ticked, trunk);
  const name = named ?? reviewNameFor(entries, ticked);
  const existing =
    review.status === "loading"
      ? undefined
      : localReview(review.document, name);
  const replaces =
    existing?.versions.findIndex((kept) => kept.operation === operation) ?? -1;
  const action =
    existing === undefined
      ? "create review"
      : replaces === -1
        ? `add v${existing.versions.length + 1} to ${name}`
        : `replace v${replaces + 1} of ${name}`;

  return (
    <RegisterStrip
      name={name}
      revset={revset}
      action={action}
      busy={busy}
      ready={
        name.trim() !== "" && revset.trim() !== "" && match?.status !== "error"
      }
      ticked={ticked.length}
      outside={matched === null ? 0 : matched.size - inGraph.length}
      problem={match?.status === "error" ? match.message : failure}
      registered={registered}
      onName={(next) => {
        setNamed(next);
        setRegistered(null);
      }}
      onRevset={(next) => {
        setTyped(next);
        setRegistered(null);
      }}
      onRegister={() => {
        setBusy(true);
        setFailure(null);
        register({ name: name.trim(), revset: revset.trim(), operation })
          .then(setRegistered, (err: unknown) =>
            setFailure(err instanceof Error ? err.message : String(err)),
          )
          .finally(() => setBusy(false));
      }}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}
```

```tsx
//| id: frontend-view-register-strip
//| file: src/frontend/views/RegisterStrip.tsx
import type { FormEvent } from "react";

export function RegisterStrip({
  name,
  revset,
  action,
  busy,
  ready,
  ticked,
  outside,
  problem,
  registered,
  onName,
  onRevset,
  onRegister,
  onOpen,
  onClose,
}: {
  name: string;
  revset: string;
  /** What the button does, in words. */
  action: string;
  busy: boolean;
  ready: boolean;
  ticked: number;
  /** Commits the revset names that the graph does not draw. */
  outside: number;
  problem: string | null;
  /** The name the last registration went under. */
  registered: string | null;
  onName: (name: string) => void;
  onRevset: (revset: string) => void;
  onRegister: () => void;
  onOpen: (name: string) => void;
  onClose: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRegister();
  };

  return (
    <form onSubmit={submit} className="register-strip">
      <div className="register-strip__row">
        <span className="register-strip__count">
          {ticked === 1 ? "1 commit" : `${ticked} commits`}
        </span>
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="review name"
          aria-label="review name"
          className="register-strip__input"
        />
        <button
          type="submit"
          disabled={busy || !ready}
          className="register-strip__submit"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="register-strip__close"
        >
          close
        </button>
      </div>
      <input
        value={revset}
        onChange={(event) => onRevset(event.target.value)}
        placeholder="tick commits or type a revset"
        aria-label="revset"
        spellCheck={false}
        className="register-strip__input register-strip__revset"
      />
      {problem !== null && (
        <p role="alert" className="register-strip__problem">
          {problem}
        </p>
      )}
      {outside > 0 && (
        <p className="register-strip__note">
          {outside === 1
            ? "1 commit it names is not drawn here."
            : `${outside} commits it names are not drawn here.`}
        </p>
      )}
      {registered !== null && (
        <p className="register-strip__note">
          Registered {registered}.{" "}
          <button
            type="button"
            onClick={() => onOpen(registered)}
            className="register-strip__open"
          >
            open it
          </button>
        </p>
      )}
    </form>
  );
}
```

The strip sits between the picker row and the graph in the surface the
review toggle lights, and its inputs and buttons are as tall as the picker
row's so the narrow rule can raise them together.

```css
/*| id: design-register-strip
@layer components {
  .register-strip {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--surface-selected);
    border-bottom: 1px solid var(--border);
  }

  .register-strip__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .register-strip__count {
    font-weight: bold;
  }

  .register-strip__input {
    flex: 1;
    min-width: 8em;
    height: 2em;
    padding: 0 var(--space-3);
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  /* Its own row in a column, where `flex: 1` would squash it to nothing. */
  .register-strip__revset {
    flex: none;
  }

  .register-strip__submit,
  .register-strip__close {
    flex: none;
    height: 2em;
    padding: 0 var(--space-4);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
    border-radius: var(--radius);
  }

  .register-strip__submit {
    color: var(--surface);
    background: var(--accent);
    border: 1px solid var(--accent);
  }

  .register-strip__submit:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .register-strip__close {
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
  }

  .register-strip__problem {
    margin: 0;
    color: var(--danger);
  }

  .register-strip__note {
    margin: 0;
    color: var(--text-muted);
  }

  .register-strip__open {
    padding: 0;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    background: transparent;
    border: none;
  }
}
```

```css
/*| id: design-register-strip
@layer components-narrow {
  @media (max-width: 1000px) {
    .review-toggle,
    .register-strip__input,
    .register-strip__submit,
    .register-strip__close {
      height: 44px;
    }
  }
}
```
