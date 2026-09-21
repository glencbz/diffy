# Local history

The screen that reviews the repository on this machine, where a side is pinned
to a jj operation.

## Loading the operation log

`useOperations` loads the operation list once, on mount.

```tsx
//| id: frontend-state-operations
//| file: src/frontend/state/operations.ts
import { useEffect, useState } from "react";
import { fetchOperations, type OpLogEntry } from "../api";
import type { AsyncState } from "./asyncState";

export function useOperations(): AsyncState<OpLogEntry[]> {
  const [state, setState] = useState<AsyncState<OpLogEntry[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    fetchOperations()
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}
```
## Operation log controller

```tsx
//| id: frontend-controller-operation-log
//| file: src/frontend/controllers/OperationLog.tsx
import { useOperations } from "../state/operations";
import { Message } from "../views/Message";
import { OperationPicker } from "../views/OperationPicker";

export function OperationLog({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  const operations = useOperations();

  if (operations.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (operations.status === "error") {
    return <Message tone="error">{operations.message}</Message>;
  }

  return (
    <OperationPicker
      operations={operations.data}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
```

## Operation picker

A single `<select>` above the graph. The first option is "latest (current)",
value `""`, which maps back to `null` (the live repo). The rest are operations
newest first, each labelled with its short id, its description or the command
that caused it, and when it finished. `onSelect` gets the operation id, or
`null` for latest.

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

function optionLabel(operation: OpLogEntry): string {
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
