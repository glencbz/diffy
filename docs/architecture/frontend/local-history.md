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
import { useEffect, useRef, useState } from "react";
import { fetchOperations } from "../api";
import { type LocalHistory, pick, withOperations } from "../model/localHistory";

const POLL_INTERVAL_MS = 2000;

type LocalSideName = "before" | "after";

export function useLocalHistory() {
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

## Operation picker

A single `<select>` above the graph. The first option is "latest (current)",
value `""`, which maps back to `null`. The rest are operations newest first,
each labelled with its short id, its description or the command that caused
it, and when it finished. `onSelect` gets the operation id, or `null` for
latest. What value it is passed for `selected` is decided above it, by
`pickerValue`: a picker never sees a side's pick directly, only where that
pick lands relative to the current head.

```tsx
//| id: frontend-view-operation-picker
//| file: src/frontend/views/OperationPicker.tsx
import type { OpLogEntry } from "../api";

export function OperationPicker({
  operations,
  selected,
  onSelect,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  return (
    <label className="operation-picker">
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
select itself take the rest of the row.

```css
/*| id: design-operation-picker
@layer components {
  .operation-picker {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .operation-picker__label {
    color: var(--text-faint);
  }

  .operation-picker__select {
    flex: 1;
    font: inherit;
  }
}
```

A `<select>` asks for the width of its longest option, and an option here is
an id, a description and a timestamp on one line, which is wider than a phone.
Capping it at the room the row has is the one place the app still shows a
fragment on purpose: the text a select cuts is a tap from being read in full,
so nothing is lost by cutting it.

```css
/*| id: design-operation-picker
@layer components-narrow {
  @media (max-width: 1000px) {
    .operation-picker__select {
      flex: 1;
      min-width: 0;
      max-width: 100%;
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
  return (
    <div className="newer-operation">
      <p className="newer-operation__note">
        A newer operation is available: {optionLabel(operation)}
      </p>
      <button
        type="button"
        className="newer-operation__action"
        onClick={onUpdate}
      >
        Update to latest
      </button>
    </div>
  );
}
```

It is laid out like `last-reviewed` on the pull request screen, which is the
same kind of prompt: a note that wraps and an outlined button at the same 44
pixel touch target, which drops under the note on a phone.

```css
/*| id: design-newer-operation
@layer components {
  .newer-operation {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
  }

  .newer-operation__note {
    flex: 1 1 auto;
    margin: 0;
  }

  .newer-operation__action {
    min-height: 44px;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
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
