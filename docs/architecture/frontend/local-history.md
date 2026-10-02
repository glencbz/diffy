# Local history

The screen that reviews the repository on this machine, where each side is
pinned to a jj operation.

## The model

A side's pick is either "latest", meaning the reader asked for the newest
operation, or "pinned" to one operation they chose from the dropdown. Either
way `at` is a concrete operation id, and a side reads the repo at `at` and
nowhere else. A side never reads the live repo, so nothing it shows changes
while the reader is looking at it. A "latest" side stays where it is when a
newer operation lands. The pick only records that the reader wanted the
newest, so the screen knows to offer the new one.

```ts
//| id: frontend-model-local-history
//| file: src/frontend/model/localHistory.ts
import type { OpLogEntry } from "../api";

/**
 * Which operation a local side reads the repo at. A `latest` side asked for
 * the newest, and `at` is what was newest when it asked.
 */
export type OperationPick =
  | { kind: "latest"; at: string }
  | { kind: "pinned"; at: string };

export interface LocalSide {
  pick: OperationPick;
  commits: string[];
}

export type LocalHistory =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      operations: OpLogEntry[];
      before: LocalSide;
      after: LocalSide;
    };
```

`withOperations` is the only place a load of the operation log turns into the
next `LocalHistory`. Both sides are made by the first successful load, on
"latest" at whatever is newest then, and every later load replaces only
`operations`. A side therefore never exists without an operation to read at.
The alternative was a side that starts at "unknown" and an effect that fills
it in once the log arrives. That costs a render at the live repo, a second
fetch at the real operation, and a state that has to be kept in sync. An idle
poll returns the same object, so it re-renders nothing.

Only a "latest" side that has fallen behind the head has a newer operation to
report, and only the after side shows it. The before side is the baseline,
and a baseline that offers to move is an invitation to lose track of what is
being compared. It stays pinned where it was without comment.

```ts
//| id: frontend-model-local-history

export function withOperations(
  history: LocalHistory,
  operations: OpLogEntry[],
): LocalHistory {
  const head = operations[0];
  if (head === undefined) return history;
  if (history.status !== "ready") {
    return {
      status: "ready",
      operations,
      before: { pick: { kind: "latest", at: head.id }, commits: [] },
      after: { pick: { kind: "latest", at: head.id }, commits: [] },
    };
  }
  if (history.operations[0]?.id === head.id) return history;
  return { ...history, operations };
}

/** What picking `operationId` from the dropdown means for a side; `null` is
 *  "latest (current)". */
export function pick(head: string, operationId: string | null): OperationPick {
  return operationId === null
    ? { kind: "latest", at: head }
    : { kind: "pinned", at: operationId };
}
```

Only a side that is still tracking latest and has fallen behind the head has
a newer operation to report, and only the after side renders it: the before
side is the historical baseline the reader picked or was handed, and moving
it under them would change what they are comparing from without being asked.

```ts
//| id: frontend-model-local-history

/** The newest operation a "latest" side has not moved to yet, or `null` when
 *  the side is pinned or already at the newest. */
export function newerOperation(
  side: LocalSide,
  operations: OpLogEntry[],
): OpLogEntry | null {
  const head = operations[0];
  if (head === undefined || side.pick.kind !== "latest") return null;
  return side.pick.at === head.id ? null : head;
}

/** What `OperationPicker` shows for a pick: `null` ("latest (current)") only
 *  when the side is latest and already at the head, its pinned operation id
 *  otherwise. */
export function pickerValue(
  sidePick: OperationPick,
  head: string,
): string | null {
  return sidePick.kind === "latest" && sidePick.at === head
    ? null
    : sidePick.at;
}
```

## Polling the operation log

`useLocalHistory` owns the one piece of state both sides and the pickers
read. It polls `fetchOperations` every two seconds while the tab is visible,
and at once when the tab becomes visible again. A `polling` ref, not state,
keeps two requests from being in flight at once. A failed poll after the
first success leaves the last good list on screen. A failed first load shows
the error and keeps polling, so the screen recovers once the backend answers.

Polling `/api/operations` is the whole of the mechanism. `jj op log`
snapshots the working copy before it lists anything, so a poll also records
an edited file as a new operation, and costs tens of milliseconds. The
alternative was a server that watches `.jj/repo/op_heads` and pushes
changes over a socket. That needs a watcher and a channel the server does not
otherwise have, and it would still miss a file edit until some other `jj`
command snapshotted it.

```tsx
//| id: frontend-state-local-history
//| file: src/frontend/state/localHistory.ts
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { fetchOperations } from "../api";
import { type LocalHistory, pick, withOperations } from "../model/localHistory";

const POLL_INTERVAL_MS = 2000;

type LocalSideName = "before" | "after";

export interface LocalHistoryHandle {
  history: LocalHistory;
  pickOperation: (side: LocalSideName, operationId: string | null) => void;
  selectCommits: (side: LocalSideName, commitIds: string[]) => void;
}

export function useLocalHistory(): LocalHistoryHandle {
  const [history, setHistory] = useState<LocalHistory>({ status: "loading" });
  const polling = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (polling.current) return;
      polling.current = true;
      try {
        const operations = await fetchOperations();
        if (!cancelled) {
          setHistory((current) => withOperations(current, operations));
        }
      } catch (err) {
        if (!cancelled) {
          setHistory((current) =>
            current.status === "loading"
              ? { status: "error", message: String(err) }
              : current,
          );
        }
      } finally {
        polling.current = false;
      }
    }

    void poll();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function pickOperation(side: LocalSideName, operationId: string | null) {
    setHistory((current) => {
      if (current.status !== "ready") return current;
      const head = current.operations[0];
      if (head === undefined) return current;
      const next = { pick: pick(head.id, operationId), commits: [] };
      return side === "before"
        ? { ...current, before: next }
        : { ...current, after: next };
    });
  }

  function selectCommits(side: LocalSideName, commitIds: string[]) {
    setHistory((current) => {
      if (current.status !== "ready") return current;
      return side === "before"
        ? { ...current, before: { ...current.before, commits: commitIds } }
        : { ...current, after: { ...current.after, commits: commitIds } };
    });
  }

  return { history, pickOperation, selectCommits };
}
```

`App` calls `useLocalHistory` and hands the handle to the local history
screen through `LocalHistoryContext`, rather than the screen calling it. The
screen unmounts whenever another tab opens, and the operations each side
reads at and the commits ticked on it are a review in progress that should
still be there when the reader comes back from the settings or a pull
request. Like the [review context](review.md#holding-it-while-it-changes)
it has no default, since an empty history would be a lie about the
repository.

```tsx
//| id: frontend-state-local-history

export const LocalHistoryContext = createContext<LocalHistoryHandle | null>(
  null,
);

export function useLocalHistoryContext(): LocalHistoryHandle {
  const local = useContext(LocalHistoryContext);
  if (local === null) {
    throw new Error("no LocalHistoryContext above this screen");
  }
  return local;
}
```

## The screen

The screen is the [mode tabs](shell.md#mode-tabs), the
[review strip](review.md), and the [panes](layout.md): the after graph, the
before graph when an interdiff is open, and the diff of what is ticked. It
takes the history and the review document from the contexts `App` provides
and its column widths from [`usePaneSizes`](layout.md#resizing-a-pane), and
from the address it needs only a way to leave.

Whether the before side is open is held here. The screen opens on one graph
and a normal diff of what is ticked in it, and the before graph only appears
when the reader asks for an interdiff. Closed, the before side's ticks are
not sent to the diff, but they are kept in the history, so closing and
reopening the interdiff does not lose them. It is not part of the address,
for the same reason the ticked commits are not: neither is.

Which pane a narrow window is showing lives here too: it is one choice about
the whole screen, made in a strip above the panes it governs, and
[`ReviewPanes`](layout.md) is a view and holds no state. On a wide screen the
value is carried and never read. It stays out of the address because it says
how big the window is, not where the reader is, and a link opened on a wide
screen would carry it for nothing.

Both are how the reader has arranged this screen, so like the open rows of
the pull request screen they start over when the screen opens again. The
history they arrange is held above the screen and does not.

The review document is handed to the local history's `DiffPane` and to
nothing else here. Wiring it into the commit pickers would mean threading it
through `CommitLog` and `CommitGraph` too, for a graph that shows nothing
about review state and has no requested feature that would use it.

```tsx
//| id: frontend-screen-local-history
//| file: src/frontend/screens/LocalHistoryScreen.tsx
import { type ReactNode, useState } from "react";
import { CommitLog } from "../controllers/CommitLog";
import { DiffPane } from "../controllers/DiffPane";
import type { LocalHistory } from "../model/localHistory";
import { newerOperation, pickerValue } from "../model/localHistory";
import { type Place, tabPlace } from "../model/place";
import { useLocalHistoryContext } from "../state/localHistory";
import { usePaneSizes } from "../state/paneSizes";
import { useReviewContext } from "../state/review";
import { InterdiffToggle } from "../views/InterdiffToggle";
import { Message } from "../views/Message";
import { ModeTabs } from "../views/ModeTabs";
import { NewerOperation } from "../views/NewerOperation";
import { OperationPicker } from "../views/OperationPicker";
import { type Pane, ReviewPanes } from "../views/ReviewPanes";
import { ReviewStrip } from "../views/ReviewStrip";

export function LocalHistoryScreen({ onGo }: { onGo: (place: Place) => void }) {
  const [pane, setPane] = useState<Pane>("after");
  const [interdiff, setInterdiff] = useState(false);
  const [sizes, resize] = usePaneSizes();
  const { history, pickOperation, selectCommits } = useLocalHistoryContext();
  const review = useReviewContext();
  const before = history.status === "ready" ? history.before : null;
  const after = history.status === "ready" ? history.after : null;

  return (
    <div className="app">
      <ModeTabs
        mode="local"
        onSelect={(mode) => {
          if (mode !== "local") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      <ReviewPanes
        before={
          <SidePicker
            history={history}
            side="before"
            onPick={(operation) => pickOperation("before", operation)}
            onSelect={(commits) => selectCommits("before", commits)}
            toggle={
              <InterdiffToggle open onToggle={() => setInterdiff(false)} />
            }
          />
        }
        after={
          <SidePicker
            history={history}
            side="after"
            onPick={(operation) => pickOperation("after", operation)}
            onSelect={(commits) => selectCommits("after", commits)}
            toggle={
              !interdiff && (
                <InterdiffToggle
                  open={false}
                  onToggle={() => setInterdiff(true)}
                />
              )
            }
          />
        }
        diff={
          <DiffPane
            comparison={{
              from: interdiff ? (before?.commits ?? []) : [],
              to: after?.commits ?? [],
            }}
            review={review}
          />
        }
        interdiff={interdiff}
        showing={pane}
        onShow={setPane}
        selected={{
          before: before?.commits.length ?? 0,
          after: after?.commits.length ?? 0,
        }}
        sizes={sizes}
        onResize={resize}
      />
    </div>
  );
}

/** One local history side: its operation picker, its commit log, and, on
 *  the picker's row, the button that opens or closes the interdiff and, for
 *  the after side, the alert that a newer operation has arrived. */
function SidePicker({
  history,
  side,
  onPick,
  onSelect,
  toggle,
}: {
  history: LocalHistory;
  side: "before" | "after";
  onPick: (operationId: string | null) => void;
  onSelect: (commitIds: string[]) => void;
  toggle: ReactNode;
}) {
  if (history.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  const local = history[side];
  const head = history.operations[0]?.id ?? local.pick.at;
  const newer =
    side === "after" ? newerOperation(local, history.operations) : null;

  return (
    <>
      <OperationPicker
        operations={history.operations}
        selected={pickerValue(local.pick, head)}
        onSelect={onPick}
      >
        {newer !== null && (
          <NewerOperation operation={newer} onUpdate={() => onPick(null)} />
        )}
        {toggle}
      </OperationPicker>
      <CommitLog
        source={{ kind: "jj", operation: local.pick.at }}
        selected={local.commits}
        onSelect={onSelect}
      />
    </>
  );
}
```

## Operation picker

A single `<select>` above the graph. The first option is "latest (current)",
value `""`, which maps back to `null`. The rest are operations newest first,
each labelled with its short id, its description or the command that caused
it, and when it finished. `onSelect` gets the operation id, or `null` for
latest. What value it is passed for `selected` is decided above it, by
`pickerValue`: a picker never sees a side's pick directly, only where that
pick lands relative to the current head.

The row also holds whatever controls the side needs beside the select,
passed in as `children`: the [newer operation](#newer-operation) notice, and
the button that opens or closes an interdiff. They sit on the picker's row so
the row is the only thing above the graph and never changes height. Anything
that came and went between the picker and the graph would push one side's
graph down and leave the two sides of an interdiff out of line.

```tsx
//| id: frontend-view-operation-picker
//| file: src/frontend/views/OperationPicker.tsx
import type { ReactNode } from "react";
import type { OpLogEntry } from "../api";

export function OperationPicker({
  operations,
  selected,
  onSelect,
  children,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
  /** Controls that sit on the picker's row after the select. */
  children?: ReactNode;
}) {
  return (
    <div className="operation-picker">
      <label className="operation-picker__field">
        <span className="operation-picker__label">operation</span>
        <select
          value={selected ?? ""}
          onChange={(event) => onSelect(event.target.value || null)}
          className="operation-picker__select"
        >
          <option value="">latest (current)</option>
          {operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {optionLabel(operation)}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  );
}

export function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
```

OperationPicker is a label wrapping a native `<select>`, so there is little
to style beyond lining the caption up with the control and letting the
select itself take the rest of the row, less whatever controls follow it.

The select and every button on the row are the same height, `2em`, so the
row is as tall with a button on it as without one. One side's row can hold a
button the other's does not, and a row a few pixels taller on one side was
enough to start its graph that much lower than the other.

A `<select>` asks for the width of its longest option, and an option here is
an id, a description and a timestamp on one line. A described operation runs
to hundreds of characters, wider than a picker pane at any window size, so
`min-width: 0` holds the select to the row it sits in. Capping it is the one
place the app still shows a fragment on purpose: the text a select cuts is a
tap from being read in full, so nothing is lost by cutting it.

```css
/*| id: design-operation-picker
@layer components {
  .operation-picker {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .operation-picker__field {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .operation-picker__label {
    color: var(--text-faint);
  }

  .operation-picker__select {
    flex: 1;
    min-width: 0;
    height: 2em;
    font: inherit;
  }
}
```

On a phone the row's controls grow to the 44 pixel touch target the other
buttons in the app keep. The select grows with them, so the row stays the
same height whichever buttons it holds.

```css
/*| id: design-operation-picker
@layer components-narrow {
  @media (max-width: 1000px) {
    .operation-picker__select,
    .newer-operation,
    .interdiff-toggle {
      height: 44px;
    }
  }
}
```

## Newer operation

The after side is the side under review, so when it is on "latest" and a
poll finds a newer head, it says so. It neither follows the new head nor
stays behind without a word. Following would swap the commits out from under
a reader mid-diff. Staying silent would leave them approving a state the repo
has already moved past. `onUpdate` picks `null`, the same as the dropdown's
first option, so updating takes the side to whatever is newest now and drops
its selected commits.

It is one button on the picker's row, reading `newer` and the operation's
short id, with the whole label in its tooltip and its accessible name. A
banner under the picker said more, but it pushed the after graph a few rows
down the moment an operation landed, out of line with the before graph
beside it.

```tsx
//| id: frontend-view-newer-operation
//| file: src/frontend/views/NewerOperation.tsx
import type { OpLogEntry } from "../api";
import { optionLabel } from "./OperationPicker";

export function NewerOperation({
  operation,
  onUpdate,
}: {
  operation: OpLogEntry;
  onUpdate: () => void;
}) {
  const label = `Update to the newer operation ${optionLabel(operation)}`;
  return (
    <button
      type="button"
      className="newer-operation"
      onClick={onUpdate}
      title={label}
      aria-label={label}
    >
      newer: {operation.id.slice(0, 8)}
    </button>
  );
}
```

It is outlined in the accent colour, so it reads as something that wants a
click rather than another label on the row.

```css
/*| id: design-newer-operation
@layer components {
  .newer-operation {
    flex: none;
    height: 2em;
    padding: 0 var(--space-4);
    font: inherit;
    color: var(--accent);
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
}
```

## Interdiff toggle

The screen shows one graph until the reader asks to compare two operations.
The button that asks sits at the end of the graph's picker row and reads
`interdiff`. Once the before side is open, the same component sits on the
before side's row and reads `close`, so the way out is beside the column it
removes. Its accessible name says what it does in full, since `close` alone
does not say what closes.

```tsx
//| id: frontend-view-interdiff-toggle
//| file: src/frontend/views/InterdiffToggle.tsx
export function InterdiffToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="interdiff-toggle"
      onClick={onToggle}
      aria-label={
        open ? "close the interdiff" : "interdiff against another operation"
      }
    >
      {open ? "close" : "interdiff"}
    </button>
  );
}
```

It is outlined in the quiet border colour, so the newer operation notice
beside it is the louder of the two.

```css
/*| id: design-interdiff-toggle
@layer components {
  .interdiff-toggle {
    flex: none;
    height: 2em;
    padding: 0 var(--space-4);
    font: inherit;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .interdiff-toggle:hover {
    color: var(--text);
  }
}
```

## Tests

```ts
//| id: frontend-model-local-history-test
//| file: src/frontend/model/localHistory.test.ts
import { describe, expect, test } from "bun:test";
import type { OpLogEntry } from "../api";
import {
  newerOperation,
  pick,
  pickerValue,
  withOperations,
} from "./localHistory";

function op(id: string): OpLogEntry {
  return {
    id,
    description: `op ${id}`,
    time: "2024-01-01T00:00:00Z",
    args: "jj",
  };
}

describe("withOperations", () => {
  test("the first load puts both sides at the newest operation, latest", () => {
    const history = withOperations({ status: "loading" }, [op("b"), op("a")]);

    expect(history).toEqual({
      status: "ready",
      operations: [op("b"), op("a")],
      before: { pick: { kind: "latest", at: "b" }, commits: [] },
      after: { pick: { kind: "latest", at: "b" }, commits: [] },
    });
  });

  test("a later poll with a new head keeps both sides where they were", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("b"), op("a")]);

    expect(polled).toMatchObject({
      before: { pick: { kind: "latest", at: "a" } },
      after: { pick: { kind: "latest", at: "a" } },
    });
  });

  test("an unchanged poll returns the same object", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("a")]);

    expect(polled).toBe(first);
  });
});

describe("newerOperation", () => {
  test("reports the newest operation for a latest side that fell behind", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("b"), op("a")]);
    if (polled.status !== "ready") throw new Error("expected ready");

    expect(newerOperation(polled.after, polled.operations)).toEqual(op("b"));
  });

  test("says nothing for a side pinned to a specific operation", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    if (first.status !== "ready") throw new Error("expected ready");
    const pinned = { ...first, after: { pick: pick("a", "a"), commits: [] } };
    const polled = withOperations(pinned, [op("b"), op("a")]);
    if (polled.status !== "ready") throw new Error("expected ready");

    expect(newerOperation(polled.after, polled.operations)).toBeNull();
  });
});

describe("pick", () => {
  test("null takes the current head as latest", () => {
    expect(pick("a", null)).toEqual({ kind: "latest", at: "a" });
  });

  test("an id pins to that operation", () => {
    expect(pick("a", "b")).toEqual({ kind: "pinned", at: "b" });
  });
});

describe("pickerValue", () => {
  test("is null only when latest and at the current head", () => {
    expect(pickerValue({ kind: "latest", at: "a" }, "a")).toBeNull();
    expect(pickerValue({ kind: "latest", at: "a" }, "b")).toBe("a");
    expect(pickerValue({ kind: "pinned", at: "a" }, "a")).toBe("a");
  });
});
```
