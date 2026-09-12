# Frontend

The review UI is a small [React](https://react.dev/) app. The left side is a
commit picker, drawn as a commit graph. The right side shows a diff. Pick a
commit and its diff loads.

An operation selector sits above the commit picker. jj records every repo
mutation as an operation; picking a past one rewinds the log (and the diff for
whatever is then selected) to how it looked right after that step, via
`jj ... --at-operation`. Leaving it on "latest" is the normal, live view.

The tech plan first sketched this in htmx. We went with React instead. The
picker carries client-side state. A selection on the left drives the diff panel
on the right, and the selection has to survive each of those loads. Component
state does that cleanly. htmx would need a stack of out-of-band swaps.

## Architecture

The app has four layers plus a root. Imports point one way down this list:

```
index.html + main.tsx   mount point
        |
      App.tsx            root, owns the shared selections
        |
   controllers/          wire a state hook to a view
      /       \
 state/        views/    state/ owns data and keeps it loaded
        |                views/ turn props into markup
     api.ts              transport, fetch plus Zod, no React
```

Each layer is named for the job it does. The `state/` modules are React hooks.
A folder called `hooks/` would say nothing, because any hook can do anything.
`state/` says what these ones are for.

### transport

`api.ts` does all the talking to the backend. It knows the three URLs and their
wire formats. It knows nothing about React. Each fetch wrapper runs its
response through a [Zod](https://zod.dev/) schema before returning it. A drift
in a backend shape then fails at the fetch, with a named parse error, before
any view sees `undefined`. `fetchOperations()`, `fetchLog(atOperation?)`, and
`fetchDiff(revision, atOperation?)` return typed promises. The optional
`atOperation` on the last two is the operation id to view history at; omitted,
the backend uses the live repo.

### state

Each `state/` module owns one slice of the app's data and keeps it current with
the backend. `useOperations` owns the operation list. `useCommitLog` owns the
commit list for the selected operation. `useRevisionDiff` owns the diff for the
selected revision. Ownership is the point. One module loads its slice and
reloads it when the input changes. The same module holds the loading and error
state around it.

`useEffect` plus fetch plus cancel-on-change is fiddly, and it runs the same
way for every slice. It lives here once. A fetching `useEffect` appears nowhere
else.

Every hook returns an `AsyncState<T>`, the union `loading | error | ready`. A
caller switches on `status`, and the union forces it to cover every case. No
gap opens up where the load has finished but the data is still missing.
`useRevisionDiff` returns `null` while nothing is selected. Its caller shows a
prompt in that state.

### views

A view in `views/` is a pure function from props to markup. Give it data and
callbacks, get elements back. It never fetches or calls into `api.ts`, and
nothing in it hints that a server exists.

These are the files you restyle and test. A test renders one with fixture props
and checks the output. There is nothing to mock.

Views take the wire types from `api.ts` as props. `CommitGraph` takes
`LogEntry[]`. `DiffView` takes `FileDiff[]`. This holds while the UI shows
exactly what the API returns. When it stops matching, add view-model types and
map to them in the controllers. Until then, skip them. A copy of the wire types
only drifts from the original.

### controllers

A controller in `controllers/` wires one state hook to one view. It calls the
hook and reads the `AsyncState`. Then it renders the view or a `Message`. It
has no markup of its own.

When there is no diff to show yet, the controller decides what goes on screen.
`DiffView` never sees that case. It stays at "render these files", with no null
checks. One panel's branching sits in one file. `OperationLog` drives
`OperationPicker`. `CommitLog` drives `CommitGraph`. `RevisionDiff` drives
`DiffView`.

### root

`App.tsx` holds two IDs: the selected change and the selected operation. Each
is read by more than one controller, and `App` is their common parent, so
`App` is where they live. Picking an operation also clears the selected
change, since a change from the live log may not exist in a past one; the
`RevisionDiff` panel falls back to its "select a commit" prompt. `SplitPane`
handles the layout, with the operation picker and the graph stacked in its
left half.

### Keeping the boundary honest

The one-way import rule is a convention today. Nothing stops a view from
importing `fetchDiff` for "just one more field". The first time that happens,
the split is gone and the view needs a running server to test again. A
follow-up adds a Biome `noRestrictedImports` rule per directory. The boundary
then fails the build without waiting for a reviewer to notice.

Allowed import edges:

- `api.ts` imports Zod only.
- `state/` imports React and `api.ts`.
- `views/` imports React, other `views/`, and `api.ts` *types*.
- `controllers/` import `state/` and `views/`.
- `App.tsx` imports `controllers/` and `views/`.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack).
Bun's bundler finds the `<script>` and `<link>` tags and bundles them, along
with the React and JSX they pull in. `Bun.serve()` returns the bundle from `/`.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Diffy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`main.tsx` mounts the React tree into `#root`. That is its whole job.

```tsx
//| id: frontend-entry
//| file: src/frontend/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container === null) throw new Error("missing #root element");

createRoot(container).render(<App />);
```

## Transport

`api.ts` has one Zod schema and one `fetch` wrapper per endpoint. `JjFileDiff`
is a discriminated union on `status`. `added`, `deleted`, and `modified` carry
a single `path`. `renamed` and `copied` carry `oldPath` and `newPath`.

```ts
//| id: frontend-api
//| file: src/frontend/api.ts
import * as z from "zod";

export const LogEntry = z.object({
  commitId: z.string(),
  changeId: z.string(),
  description: z.string(),
  parents: z.array(z.string()),
});
export type LogEntry = z.infer<typeof LogEntry>;

const LogResponse = z.array(LogEntry);

export const OpLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  time: z.string(),
  args: z.string(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;

const OpLogResponse = z.array(OpLogEntry);

const fileDiffFields = {
  binary: z.boolean(),
  patch: z.string(),
};

export const FileDiff = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), path: z.string(), ...fileDiffFields }),
  z.object({
    status: z.literal("deleted"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("modified"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("renamed"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("copied"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
]);
export type FileDiff = z.infer<typeof FileDiff>;

const DiffResponse = z.object({
  revision: z.string(),
  files: z.array(FileDiff),
});
export type DiffResponse = z.infer<typeof DiffResponse>;

const ErrorResponse = z.object({ error: z.string() });

/** GET a jj-backed endpoint, turning a 400 into its `error` message. */
async function getJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  const body: unknown = await res.json();

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
    );
  }

  return body;
}

export async function fetchOperations(): Promise<OpLogEntry[]> {
  return OpLogResponse.parse(
    await getJson("/api/operations", "GET /api/operations"),
  );
}

export async function fetchLog(atOperation?: string): Promise<LogEntry[]> {
  const query = atOperation ? `?op=${encodeURIComponent(atOperation)}` : "";
  return LogResponse.parse(await getJson(`/api/log${query}`, "GET /api/log"));
}

export async function fetchDiff(
  revision: string,
  atOperation?: string,
): Promise<DiffResponse> {
  const params = new URLSearchParams({ rev: revision });
  if (atOperation) params.set("op", atOperation);
  return DiffResponse.parse(
    await getJson(`/api/diff?${params}`, "GET /api/diff"),
  );
}
```

## State

Every slice reports its status as an `AsyncState<T>`.

```ts
//| id: frontend-async-state
//| file: src/frontend/state/asyncState.ts
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
```

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

`useCommitLog` takes the selected operation (or `null` for the live repo) and
reloads the log whenever it changes, dropping a response that lands after the
operation has moved on again.

```tsx
//| id: frontend-state-commit-log
//| file: src/frontend/state/commitLog.ts
import { useEffect, useState } from "react";
import { fetchLog, type LogEntry } from "../api";
import type { AsyncState } from "./asyncState";

export function useCommitLog(
  atOperation: string | null,
): AsyncState<LogEntry[]> {
  const [state, setState] = useState<AsyncState<LogEntry[]>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchLog(atOperation ?? undefined)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [atOperation]);

  return state;
}
```

`useRevisionDiff` reloads whenever `revision` or `atOperation` changes. If a
response comes back after either has already moved, the hook drops it.

```tsx
//| id: frontend-state-revision-diff
//| file: src/frontend/state/revisionDiff.ts
import { useEffect, useState } from "react";
import { type DiffResponse, fetchDiff } from "../api";
import type { AsyncState } from "./asyncState";

export function useRevisionDiff(
  revision: string | null,
  atOperation: string | null,
): AsyncState<DiffResponse> | null {
  const [state, setState] = useState<AsyncState<DiffResponse> | null>(null);

  useEffect(() => {
    if (revision === null) {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    fetchDiff(revision, atOperation ?? undefined)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [revision, atOperation]);

  return state;
}
```

## Views

### SplitPane

```tsx
//| id: frontend-view-split-pane
//| file: src/frontend/views/SplitPane.tsx
import type { ReactNode } from "react";

export function SplitPane({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: "38%",
          minWidth: 260,
          overflow: "auto",
          borderRight: "1px solid #ccc",
        }}
      >
        {left}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>{right}</div>
    </div>
  );
}
```

### Message

The controllers route all of their status text through this one component.

```tsx
//| id: frontend-view-message
//| file: src/frontend/views/Message.tsx
import type { ReactNode } from "react";

export function Message({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <p style={{ padding: 12, color: tone === "error" ? "#cf222e" : "#333" }}>
      {children}
    </p>
  );
}
```

### Operation picker

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
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderBottom: "1px solid #ccc",
      }}
    >
      <span style={{ color: "#888" }}>operation</span>
      <select
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        style={{ flex: 1, font: "inherit" }}
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

### Commit graph

One lane. One node per commit, top to bottom in the order the backend sent
them. A commit with more than one parent is a merge and shows as a hollow node.
Side-by-side branch lanes are not built yet. The history is mostly linear, so
the one lane matches `jj log` for now. Clicking a row selects that change.

```tsx
//| id: frontend-view-commit-graph
//| file: src/frontend/views/CommitGraph.tsx
import type { LogEntry } from "../api";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string | null;
  onSelect: (changeId: string) => void;
}) {
  return (
    <div>
      {commits.map((commit, index) => {
        const isSelected = commit.changeId === selected;
        return (
          <button
            type="button"
            key={commit.changeId}
            onClick={() => onSelect(commit.changeId)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              height: ROW_HEIGHT,
              padding: 0,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              font: "inherit",
              textAlign: "left",
              background: isSelected ? "#d0e4ff" : "transparent",
            }}
          >
            <Lane
              hasAbove={index > 0}
              hasBelow={index < commits.length - 1}
              isMerge={commit.parents.length > 1}
            />
            <span style={{ color: "#888", marginRight: 8 }}>
              {commit.changeId.slice(0, 8)}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {firstLine(commit.description) || (
                <em style={{ color: "#999" }}>(no description)</em>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Lane({
  hasAbove,
  hasBelow,
  isMerge,
}: {
  hasAbove: boolean;
  hasBelow: boolean;
  isMerge: boolean;
}) {
  const center = LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;
  return (
    <svg
      width={LANE_WIDTH}
      height={ROW_HEIGHT}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      {hasAbove && (
        <line x1={center} y1={0} x2={center} y2={middle} stroke="#999" />
      )}
      {hasBelow && (
        <line
          x1={center}
          y1={middle}
          x2={center}
          y2={ROW_HEIGHT}
          stroke="#999"
        />
      )}
      <circle
        cx={center}
        cy={middle}
        r={4}
        fill={isMerge ? "#fff" : "#333"}
        stroke="#333"
      />
    </svg>
  );
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
```

### Diff view

Renders each file's verbatim `git`-format patch. The one thing it adds is
color. `+` lines green, `-` lines red, `@@` hunk headers blue, file headers
grey. A binary file gets a placeholder in place of a patch body. The caller
always hands it a real `files` array. The controller deals with anything that
is not a rendered diff.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import type { FileDiff } from "../api";

export function DiffView({ files }: { files: FileDiff[] }) {
  return (
    <div style={{ padding: 12 }}>
      {files.map((file) => (
        <FileRow key={pathOf(file)} file={file} />
      ))}
    </div>
  );
}

function FileRow({ file }: { file: FileDiff }) {
  return (
    <section style={{ marginBottom: 16, border: "1px solid #ccc" }}>
      <header
        style={{
          background: "#f0f0f0",
          padding: "4px 8px",
          fontWeight: "bold",
        }}
      >
        <span style={{ color: "#666", marginRight: 8 }}>{file.status}</span>
        {pathOf(file)}
      </header>
      {file.binary ? (
        <p style={{ padding: 8, fontStyle: "italic", color: "#666" }}>
          Binary file, no textual diff.
        </p>
      ) : (
        <pre style={{ margin: 0, padding: 8, overflowX: "auto" }}>
          {file.patch.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
            <div key={index} style={{ color: lineColor(line) }}>
              {line === "" ? " " : line}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

function lineColor(line: string): string | undefined {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "#666";
  if (line.startsWith("diff --git ") || line.startsWith("index "))
    return "#666";
  if (line.startsWith("@@")) return "#0969da";
  if (line.startsWith("+")) return "#1a7f37";
  if (line.startsWith("-")) return "#cf222e";
  return undefined;
}
```

## Controllers

### Operation log

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

### Commit log

```tsx
//| id: frontend-controller-commit-log
//| file: src/frontend/controllers/CommitLog.tsx
import { useCommitLog } from "../state/commitLog";
import { CommitGraph } from "../views/CommitGraph";
import { Message } from "../views/Message";

export function CommitLog({
  atOperation,
  selected,
  onSelect,
}: {
  atOperation: string | null;
  selected: string | null;
  onSelect: (changeId: string) => void;
}) {
  const log = useCommitLog(atOperation);

  if (log.status === "loading") return <Message>Loading commits...</Message>;
  if (log.status === "error") {
    return <Message tone="error">{log.message}</Message>;
  }

  return (
    <CommitGraph commits={log.data} selected={selected} onSelect={onSelect} />
  );
}
```

### Revision diff

```tsx
//| id: frontend-controller-revision-diff
//| file: src/frontend/controllers/RevisionDiff.tsx
import { useRevisionDiff } from "../state/revisionDiff";
import { DiffView } from "../views/DiffView";
import { Message } from "../views/Message";

export function RevisionDiff({
  revision,
  atOperation,
}: {
  revision: string | null;
  atOperation: string | null;
}) {
  const diff = useRevisionDiff(revision, atOperation);

  if (diff === null) {
    return <Message>Select a commit to see its diff.</Message>;
  }
  if (diff.status === "loading") return <Message>Loading diff...</Message>;
  if (diff.status === "error") {
    return <Message tone="error">{diff.message}</Message>;
  }
  if (diff.data.files.length === 0) {
    return <Message>No changes in this commit.</Message>;
  }

  return <DiffView files={diff.data.files} />;
}
```

## App

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { OperationLog } from "./controllers/OperationLog";
import { RevisionDiff } from "./controllers/RevisionDiff";
import { SplitPane } from "./views/SplitPane";

export function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);

  function selectOperation(operationId: string | null) {
    setOperation(operationId);
    setSelected(null);
  }

  return (
    <SplitPane
      left={
        <>
          <OperationLog selected={operation} onSelect={selectOperation} />
          <CommitLog
            atOperation={operation}
            selected={selected}
            onSelect={setSelected}
          />
        </>
      }
      right={<RevisionDiff revision={selected} atOperation={operation} />}
    />
  );
}
```
