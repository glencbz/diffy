# Local history

The screen that reviews the repository on this machine, where each side is
pinned to a jj operation.

## The model

A side's pick is "latest" or "pinned", and either way `at` is a concrete
operation id. A side never reads the live repo, so nothing changes under the
reader; "latest" only means the screen offers a newer operation when one
lands.

```ts
//| id: frontend-model-local-history
//| file: src/frontend/model/localHistory.ts
import type { OpLogEntry } from "./history";

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

`withOperations` makes both sides on the first successful load, so a side
never exists without an operation. A side starting "unknown" would cost a
render at the live repo, a second fetch, and an effect to keep in sync.

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
  // An idle poll returns the same object and re-renders nothing.
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

```ts
//| id: frontend-model-local-history

/** The newest operation a "latest" side has not moved to yet, or `null` when
 *  the side is pinned or already at the newest. Only the after side shows it:
 *  the before side is the baseline, and offering to move it invites losing
 *  track of what is compared. */
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

`useLocalHistory` polls `fetchOperations` every two seconds while the tab is
visible. `jj op log` snapshots the working copy first, so a poll also turns a
file edit into an operation. A server watching `op_heads` and pushing over a
socket would need a watcher and a channel, and would still miss an edit until
some jj command snapshotted it. A failed poll keeps the last good list; a
failed first load keeps polling.

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

`App` holds it in `LocalHistoryContext` so the picks and ticks survive a
visit to another tab.

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

The screen holds whether the interdiff is open, whether it is drawn on two
graphs or [one](combined-graph.md), and which pane a narrow window shows. All
three are arrangement, not place, so they stay out of the address and reset
when the screen reopens. Closing the interdiff keeps the before side's ticks
in the history but stops sending them to the diff.

The two arrangements answer different questions. Two graphs keep each
operation's log exactly as jj draws it, which is what a reader needs to see
the shape of either history. One graph lines up each change with itself
across the operations, so what was rewritten, added or dropped reads off one
row instead of a hunt between columns. Both send the diff the same ticks, so
switching arrangement never changes the comparison.

It also holds whether the strip that
[registers a local review](local-reviews.md#registering-from-the-graph) is
open over the graph. Only the lone graph offers it: an interdiff compares two
operations rather than declaring a series ready, and the strip would push the
after graph out of line with the before one.

```tsx
//| id: frontend-screen-local-history
//| file: src/frontend/screens/LocalHistoryScreen.tsx
import { type ReactNode, useState } from "react";
import { CombinedLog } from "../controllers/CombinedLog";
import { CommitLog } from "../controllers/CommitLog";
import { DiffPane } from "../controllers/DiffPane";
import { RegisterReview } from "../controllers/RegisterReview";
import type { LocalHistory } from "../model/localHistory";
import { newerOperation, pickerValue } from "../model/localHistory";
import { openLocal, type Place, tabPlace } from "../model/place";
import { useLocalHistoryContext } from "../state/localHistory";
import { usePaneSizes } from "../state/paneSizes";
import { useReviewContext } from "../state/review";
import { GraphsToggle } from "../views/GraphsToggle";
import { InterdiffToggle } from "../views/InterdiffToggle";
import { Message } from "../views/Message";
import { ModeTabs } from "../views/ModeTabs";
import { NewerOperation } from "../views/NewerOperation";
import { OperationPicker } from "../views/OperationPicker";
import { type Pane, ReviewPanes } from "../views/ReviewPanes";
import { ReviewStrip } from "../views/ReviewStrip";
import { ReviewToggle } from "../views/ReviewToggle";

type LocalSideName = "before" | "after";

export function LocalHistoryScreen({ onGo }: { onGo: (place: Place) => void }) {
  const [pane, setPane] = useState<Pane>("after");
  const [interdiff, setInterdiff] = useState(false);
  const [oneGraph, setOneGraph] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [sizes, resize] = usePaneSizes();
  const { history, pickOperation, selectCommits } = useLocalHistoryContext();
  const review = useReviewContext();
  const before = history.status === "ready" ? history.before : null;
  const after = history.status === "ready" ? history.after : null;

  // The before side's row carries the interdiff's own controls.
  const beforeControls = (
    <>
      <GraphsToggle
        oneGraph={oneGraph}
        onToggle={() => setOneGraph(!oneGraph)}
      />
      <InterdiffToggle open onToggle={() => setInterdiff(false)} />
    </>
  );

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
            toggle={beforeControls}
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
                <>
                  <ReviewToggle
                    open={registering}
                    ticked={after?.commits.length ?? 0}
                    onToggle={() => setRegistering((open) => !open)}
                  />
                  <InterdiffToggle
                    open={false}
                    onToggle={() => {
                      setRegistering(false);
                      setInterdiff(true);
                    }}
                  />
                </>
              )
            }
            strip={
              registering &&
              !interdiff &&
              after !== null && (
                <RegisterReview
                  operation={after.pick.at}
                  ticked={after.commits}
                  onTick={(commits) => selectCommits("after", commits)}
                  onOpen={(name) =>
                    onGo({ tab: "reviews", review: openLocal(name) })
                  }
                  onClose={() => setRegistering(false)}
                />
              )
            }
          />
        }
        combined={
          <CombinedPicker
            history={history}
            onPick={pickOperation}
            onSelect={selectCommits}
            toggle={beforeControls}
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
        layout={!interdiff ? "log" : oneGraph ? "combined" : "split"}
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

/** One local history side: its operation picker and its commit log, with
 *  `strip` between them when one is passed. */
function SidePicker({
  history,
  side,
  onPick,
  onSelect,
  toggle,
  strip,
}: {
  history: LocalHistory;
  side: LocalSideName;
  onPick: (operationId: string | null) => void;
  onSelect: (commitIds: string[]) => void;
  toggle: ReactNode;
  strip?: ReactNode;
}) {
  if (history.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  return (
    <>
      <SideOperation
        history={history}
        side={side}
        label="operation"
        onPick={onPick}
        toggle={toggle}
      />
      {strip}
      <CommitLog
        source={{ kind: "jj", operation: history[side].pick.at }}
        selected={history[side].commits}
        onSelect={onSelect}
      />
    </>
  );
}

/** The one-graph interdiff: both sides' operation pickers, each labelled
 *  with its side, over the graph that combines their logs. */
function CombinedPicker({
  history,
  onPick,
  onSelect,
  toggle,
}: {
  history: LocalHistory;
  onPick: (side: LocalSideName, operationId: string | null) => void;
  onSelect: (side: LocalSideName, commitIds: string[]) => void;
  toggle: ReactNode;
}) {
  if (history.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  return (
    <>
      <SideOperation
        history={history}
        side="before"
        label="before"
        onPick={(operation) => onPick("before", operation)}
        toggle={toggle}
      />
      <SideOperation
        history={history}
        side="after"
        label="after"
        onPick={(operation) => onPick("after", operation)}
        toggle={null}
      />
      <CombinedLog
        operations={{
          before: history.before.pick.at,
          after: history.after.pick.at,
        }}
        selected={{
          before: history.before.commits,
          after: history.after.commits,
        }}
        onSelect={onSelect}
      />
    </>
  );
}

/** A side's picker row: the operation, then the controls passed in and, for
 *  the after side, the alert that a newer operation has arrived. */
function SideOperation({
  history,
  side,
  label,
  onPick,
  toggle,
}: {
  history: Extract<LocalHistory, { status: "ready" }>;
  side: LocalSideName;
  label: string;
  onPick: (operationId: string | null) => void;
  toggle: ReactNode;
}) {
  const local = history[side];
  const head = history.operations[0]?.id ?? local.pick.at;
  const newer =
    side === "after" ? newerOperation(local, history.operations) : null;

  return (
    <OperationPicker
      operations={history.operations}
      selected={pickerValue(local.pick, head)}
      onSelect={onPick}
      label={label}
    >
      {newer !== null && (
        <NewerOperation operation={newer} onUpdate={() => onPick(null)} />
      )}
      {toggle}
    </OperationPicker>
  );
}
```

## Operation picker

The picker row also holds the [newer operation](#newer-operation) notice and
the interdiff's toggles as `children`, so nothing comes and goes between picker
and graph to push one side's graph out of line with the other.

The picker is a listbox drawn by the app rather than a native `<select>`. A
browser draws a select's options in a menu of its own, as wide as the longest
operation description and in the system font, so it spills past the column
it belongs to. The list here opens beneath the picker row and spans it, so it
is as wide as the column. The field alone would be too narrow, since the row's
buttons take most of a narrow column. Each option cuts its description to one line between the operation id and
when it ran, and keeps the full label as its title and accessible name.

Opening the list puts focus on it with the current pick active. The arrow
keys, Home and End move the active option, Enter or Space picks it, and
Escape or a click outside closes the list without picking.

```tsx
//| id: frontend-view-operation-picker
//| file: src/frontend/views/OperationPicker.tsx
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { OpLogEntry } from "../model/history";

export function OperationPicker({
  operations,
  selected,
  onSelect,
  label = "operation",
  children,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
  /** Names the field; a column holding both sides' pickers names each
   *  after its side. */
  label?: string;
  /** Controls that sit on the picker's row after the field. */
  children?: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const choices: (string | null)[] = [null, ...operations.map((op) => op.id)];
  const at = Math.max(0, choices.indexOf(selected));
  const [active, setActive] = useState(at);
  const current = operations.find((operation) => operation.id === selected);

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const show = () => {
    setActive(at);
    setOpen(true);
  };
  const pick = (index: number) => {
    setOpen(false);
    const choice = choices[index];
    if (choice !== undefined && choice !== selected) onSelect(choice);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const last = choices.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    const move = moves[event.key];
    if (move !== undefined) setActive(move);
    else if (event.key === "Enter" || event.key === " ") pick(active);
    else if (event.key === "Escape") setOpen(false);
    else return;
    event.preventDefault();
  };

  return (
    <div className="operation-picker">
      <div className="operation-picker__field">
        <span className="operation-picker__label" id={`${id}-label`}>
          {label}
        </span>
        <button
          type="button"
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          title={current === undefined ? undefined : optionLabel(current)}
          onClick={() => (open ? setOpen(false) : show())}
          className="operation-picker__trigger"
        >
          {current === undefined ? (
            <OptionText what="latest (current)" />
          ) : (
            <OperationText operation={current} />
          )}
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="close the operation list"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="operation-picker__scrim"
            />
            <div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-labelledby={`${id}-label`}
              aria-activedescendant={`${id}-${active}`}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="operation-picker__list"
            >
              {choices.map((choice, index) => {
                const operation = operations[index - 1];
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys for its options
                  <div
                    key={choice ?? ""}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={choice === selected}
                    tabIndex={-1}
                    title={
                      operation === undefined
                        ? undefined
                        : optionLabel(operation)
                    }
                    aria-label={
                      operation === undefined
                        ? undefined
                        : optionLabel(operation)
                    }
                    onClick={() => pick(index)}
                    onMouseMove={() => setActive(index)}
                    className={
                      index === active
                        ? "operation-picker__option operation-picker__option--active"
                        : "operation-picker__option"
                    }
                  >
                    {operation === undefined ? (
                      <OptionText what="latest (current)" />
                    ) : (
                      <OperationText operation={operation} />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function OperationText({ operation }: { operation: OpLogEntry }) {
  return (
    <OptionText
      id={operation.id.slice(0, 8)}
      what={operation.description || operation.args}
      when={operation.time.slice(5, 16).replace("T", " ")}
    />
  );
}

function OptionText({
  id,
  what,
  when,
}: {
  id?: string;
  what: string;
  when?: string;
}) {
  return (
    <>
      {id !== undefined && <span className="operation-picker__id">{id}</span>}
      <span className="operation-picker__what">{what}</span>
      {when !== undefined && (
        <span className="operation-picker__when">{when}</span>
      )}
    </>
  );
}

export function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
```

Every control on the row is `2em` tall, so a row with a button is as tall as
one without. `min-width: 0` holds the field to its row, since a described
operation is wider than any pane. The list hangs from the row, so its width is
the column's, and it scrolls past half the window's height.

```css
/*| id: design-operation-picker
@layer components {
  .operation-picker {
    position: relative;
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

  .operation-picker__trigger {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    height: 2em;
    padding: 0 var(--space-4);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .operation-picker__trigger::after {
    flex: none;
    margin-left: auto;
    color: var(--text-faint);
    content: "▾";
  }

  .operation-picker__trigger:hover,
  .operation-picker__trigger[aria-expanded="true"] {
    border-color: var(--accent);
  }

  .operation-picker__scrim {
    position: fixed;
    z-index: 3;
    inset: 0;
    padding: 0;
    background: transparent;
    border: none;
  }

  .operation-picker__list {
    position: absolute;
    z-index: 4;
    top: calc(100% - var(--space-2));
    right: var(--space-4);
    left: var(--space-4);
    max-height: 50vh;
    overflow-y: auto;
    padding: var(--space-2) 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
    outline: none;
  }

  .operation-picker__option {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
  }

  .operation-picker__option--active {
    background: var(--surface-sunken);
  }

  .operation-picker__option[aria-selected="true"] {
    background: var(--surface-selected);
  }

  .operation-picker__id,
  .operation-picker__when {
    flex: none;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .operation-picker__what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
```

```css
/*| id: design-operation-picker
@layer components-narrow {
  /* The app's 44px touch target, on every control so the row stays even. */
  @media (max-width: 1000px) {
    .operation-picker__trigger,
    .newer-operation,
    .interdiff-toggle {
      height: 44px;
    }

    .operation-picker__option {
      min-height: 44px;
      box-sizing: border-box;
    }

    /* The time is the first thing to go on a phone; the title keeps it. */
    .operation-picker__when {
      display: none;
    }
  }
}
```

## Newer operation

When the after side is on "latest" and a newer operation lands, a `newer`
button says so rather than following it (swapping commits under a reader
mid-diff) or staying silent (approving a state the repo moved past).
Updating picks `null`, the newest now, and drops the side's selection. It
sits on the picker row because a banner pushed the after graph down.

```tsx
//| id: frontend-view-newer-operation
//| file: src/frontend/views/NewerOperation.tsx
import type { OpLogEntry } from "../model/history";
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

`interdiff` on the after side's row opens the before side; the same button
on the before row reads `close`, beside the column it removes.

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

## Graphs toggle

`one graph` beside `close` redraws an open interdiff on one graph, and the
same button there reads `two graphs`. It lives on the before row, with the
other control that only an interdiff has.

```tsx
//| id: frontend-view-graphs-toggle
//| file: src/frontend/views/GraphsToggle.tsx
export function GraphsToggle({
  oneGraph,
  onToggle,
}: {
  oneGraph: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="interdiff-toggle"
      onClick={onToggle}
      aria-label={
        oneGraph
          ? "show the interdiff on two graphs"
          : "show the interdiff on one graph"
      }
    >
      {oneGraph ? "two graphs" : "one graph"}
    </button>
  );
}
```

## Tests

```ts
//| id: frontend-model-local-history-test
//| file: src/frontend/model/localHistory.test.ts
import { describe, expect, test } from "bun:test";
import type { OpLogEntry } from "./history";
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
