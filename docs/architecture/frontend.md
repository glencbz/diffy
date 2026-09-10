# Frontend

The review UI is a small [React](https://react.dev/) app. It has two commit
pickers, *before* and *after*, each drawn as a commit graph, and one diff panel.
Pick a commit on each side and the panel shows their interdiff: how the after
commit's change differs from the before commit's.

Either side takes any number of commits. Pick a whole branch on the left and
the branch it became on the right, and the panel shows one row per commit,
lined up by [`alignSeries`](backend/series.md) and scrolled like a branch.
Reviewing a re-pushed series is the case the tool is for, and it is not a
commit-at-a-time job.

An operation selector sits above each picker. jj records every repo mutation as
an operation; picking a past one rewinds that side's log to how it looked right
after that step, via `jj ... --at-operation`. The two sides choose
independently, and that is the whole point. A commit as it stood ten operations
ago and the same commit now are exactly the pair worth comparing, and no single
view of the repo holds both.

A commit with nothing opposite it shows its own diff, whether that is because
the reader picked one side only or because the commit was added to or dropped
from the series. "Pick a commit, read its diff" is then this same screen with
an empty before side, rather than a second mode to switch into.

The tech plan first sketched this in htmx. We went with React instead. The
pickers carry client-side state. Two selections drive the diff panel, and both
have to survive each of those loads. Component state does that cleanly. htmx
would need a stack of out-of-band swaps.

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

`api.ts` does all the talking to the backend. It knows the backend's URLs and
their wire formats. It knows nothing about React. Each fetch wrapper runs its
response through a [Zod](https://zod.dev/) schema before returning it. A drift
in a backend shape then fails at the fetch, with a named parse error, before
any view sees `undefined`. `fetchOperations()`, `fetchLog(atOperation?)`,
`fetchDiff(revision, atOperation?)`, and `fetchInterdiff(from, to)` return
typed promises. The optional `atOperation` is the operation id to view history
at; omitted, the backend uses the live repo. `fetchInterdiff` needs no such
argument: it names its two commits by commit id, which resolves in any view.

### state

Each `state/` module owns one slice of the app's data and keeps it current with
the backend. `useOperations` owns the operation list. `useCommitLog` owns the
commit list for one side's selected operation, so there is one instance of it
per side. `useInterdiff` owns the diff between the two selected commits. Ownership is the point. One module loads its slice and
reloads it when the input changes. The same module holds the loading and error
state around it.

`useEffect` plus fetch plus cancel-on-change is fiddly, and it runs the same
way for every slice. It lives here once. A fetching `useEffect` appears nowhere
else.

Every hook returns an `AsyncState<T>`, the union `loading | error | ready`. A
caller switches on `status`, and the union forces it to cover every case. No
gap opens up where the load has finished but the data is still missing.
`useInterdiff` returns `null` while both sides are empty. Its caller shows a
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
`OperationPicker`. `CommitLog` drives `CommitGraph`. `Interdiff` drives
`ComparisonHeader` and `DiffView`.

### root

`App.tsx` holds one pair of IDs per side: the selected operation and the
selected commit. Each pair is read by more than one controller, and `App` is
their common parent, so `App` is where they live. `useSide` is that pair and
the two setters, written once and called twice, because the two sides differ
in nothing but which half of the comparison they feed. It stays in `App.tsx`
rather than `state/`, which is for slices backed by the server; this one never
touches the network.

Picking an operation also clears that side's selected commit, since a commit
listed in one operation's log need not appear in another's. `ReviewPanes`
handles the layout: the two pickers as narrow columns, the diff taking the
rest.

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

export const InterdiffRow = z.object({
  from: LogEntry.nullable(),
  to: LogEntry.nullable(),
  files: z.array(FileDiff),
});
export type InterdiffRow = z.infer<typeof InterdiffRow>;

const InterdiffResponse = z.object({ rows: z.array(InterdiffRow) });
export type InterdiffResponse = z.infer<typeof InterdiffResponse>;

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

export async function fetchInterdiff(
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return InterdiffResponse.parse(
    await getJson(`/api/interdiff?${params}`, "GET /api/interdiff"),
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

`useInterdiff` reloads whenever either selection changes. If a response comes
back after either has already moved, the hook drops it. Both sides empty means
nothing to ask the backend, so the hook reports `null` without a request.

The selections are arrays, and a fresh array every render would restart the
effect every render. The effect therefore depends on the joined ids, which two
equal selections share, and unpacks them again on the way in. Nothing else in
the hook reads the array props, so there is no second copy to fall out of date.

```tsx
//| id: frontend-state-interdiff
//| file: src/frontend/state/interdiff.ts
import { useEffect, useState } from "react";
import { fetchInterdiff, type InterdiffResponse } from "../api";
import type { AsyncState } from "./asyncState";

export function useInterdiff(
  from: string[],
  to: string[],
): AsyncState<InterdiffResponse> | null {
  const [state, setState] = useState<AsyncState<InterdiffResponse> | null>(
    null,
  );
  const fromKey = from.join(" ");
  const toKey = to.join(" ");

  useEffect(() => {
    const fromIds = fromKey.split(" ").filter(Boolean);
    const toIds = toKey.split(" ").filter(Boolean);
    if (fromIds.length === 0 && toIds.length === 0) {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    fetchInterdiff(fromIds, toIds)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [fromKey, toKey]);

  return state;
}
```

## Views

### ReviewPanes

Three columns: the two pickers, then the diff. The pickers are narrow and
fixed; the diff takes what is left, because it is the thing being read. Each
picker column carries its own caption, since "before" and "after" are the only
labels that say which direction the interdiff runs.

```tsx
//| id: frontend-view-review-panes
//| file: src/frontend/views/ReviewPanes.tsx
import type { ReactNode } from "react";

export function ReviewPanes({
  before,
  after,
  diff,
}: {
  before: ReactNode;
  after: ReactNode;
  diff: ReactNode;
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
      <PickerColumn caption="before">{before}</PickerColumn>
      <PickerColumn caption="after">{after}</PickerColumn>
      <div style={{ flex: 1, overflow: "auto" }}>{diff}</div>
    </div>
  );
}

function PickerColumn({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "25%",
        minWidth: 240,
        borderRight: "1px solid #ccc",
      }}
    >
      <h2
        style={{
          margin: 0,
          padding: "6px 8px",
          font: "inherit",
          fontWeight: "bold",
          background: "#f0f0f0",
          borderBottom: "1px solid #ccc",
        }}
      >
        {caption}
      </h2>
      <div style={{ overflow: "auto" }}>{children}</div>
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

### Commit label

The graph rows and the diff panel's header both name a commit the same way: its
short change id, then the first line of its description. One component, so the
two never drift apart.

```tsx
//| id: frontend-view-commit-label
//| file: src/frontend/views/CommitLabel.tsx
import type { LogEntry } from "../api";

export function CommitLabel({ commit }: { commit: LogEntry }) {
  const summary = commit.description.split("\n")[0] ?? "";
  return (
    <>
      <span style={{ color: "#888", marginRight: 8 }}>
        {commit.changeId.slice(0, 8)}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {summary || <em style={{ color: "#999" }}>(no description)</em>}
      </span>
    </>
  );
}
```

### Comparison header

Every row says what it is showing before it shows it: which commit is the
before side, which is the after side, and when one of them is missing. Without
it a row is an unlabelled patch, and with two independent operation pickers on
screen and several rows stacked up, there is no way to work back to what was
compared.

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  from,
  to,
}: {
  from: LogEntry | null;
  to: LogEntry | null;
}) {
  return (
    <header
      style={{
        padding: "8px 12px",
        background: "#fafafa",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Row caption="before" commit={from} />
      <Row caption="after" commit={to} />
    </header>
  );
}

function Row({
  caption,
  commit,
}: {
  caption: string;
  commit: LogEntry | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "#888", width: 56, flex: "none" }}>{caption}</span>
      {commit === null ? (
        <em style={{ color: "#999" }}>not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}
```

### Commit graph

Side-by-side branch lanes. One node per commit, top to bottom in the order the
backend sent them, where a child always lands above its parents. Each lane
tracks the commit it is currently routing toward. A commit takes the leftmost
lane already pointing at it, or a fresh lane when none is. Its first parent
stays in that lane; the extra parents of a merge fan out into their own lanes,
and a commit with more than one parent draws as a hollow node. A lane that
already points at a parent absorbs the incoming branch instead of doubling up,
which is how a side branch collapses back into its base.

`layoutGraph` is the whole algorithm, and it is pure, commits in, lanes and
edges out. The view just turns each row into an `<svg>` gutter. Lane colour is
cycled by index so parallel branches stay distinct, and lane zero stays grey,
so a linear history looks the same as `jj log`.

Clicking a row toggles that commit by commit id, while the row goes on showing
a change id, which is shorter and is what `jj log` prints. The two are not
interchangeable as identifiers. A change id names whichever version of a commit
the current view holds, so it says something different in each operation's log,
and a selection has to keep meaning the one commit the reader clicked.

Any number of rows can be selected, and the graph hands back the whole
selection rather than the row that was clicked. It orders that selection the
way the log is ordered, because it is the only piece of the app that knows
what the order is. Click order would mean a series lines up against the other
side in whatever sequence the reader happened to click, which is not an order
at all.

```tsx
//| id: frontend-view-commit-graph
//| file: src/frontend/views/CommitGraph.tsx
import type { LogEntry } from "../api";
import { CommitLabel } from "./CommitLabel";

const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;

// Lane zero stays grey, so a linear history is unchanged; branches get colour.
const LANE_COLORS = [
  "#333",
  "#0969da",
  "#1a7f37",
  "#8250df",
  "#bf8700",
  "#1b7c83",
  "#cf222e",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] as string;
}

export type GraphEdge = { from: number; to: number };

export type GraphRow = {
  /** Lane holding this commit's node. */
  lane: number;
  isMerge: boolean;
  /** Top-half segments, drawn from (from, y=0) to (to, y=middle). */
  incoming: GraphEdge[];
  /** Bottom-half segments, drawn from (from, y=middle) to (to, y=bottom). */
  outgoing: GraphEdge[];
};

export type GraphLayout = {
  rows: GraphRow[];
  /** Widest lane count any row reaches; drives the gutter width. */
  laneCount: number;
};

/**
 * Assign every commit a lane and the edges linking it to its parents. Input
 * order is the backend's: a child always precedes its parents. `lanes[i]` is
 * the commitId lane `i` is routing toward, or null when the lane is free.
 */
export function layoutGraph(commits: LogEntry[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 1;

  const firstFree = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const above = lanes.slice();

    // The node sits in the leftmost lane already routing to it, else a new one.
    const claimed = above
      .map((id, i) => (id === commit.commitId ? i : -1))
      .filter((i) => i !== -1);
    const lane = claimed.length > 0 ? (claimed[0] as number) : firstFree();

    // Every lane that was routing to this commit terminates at the node.
    for (const i of claimed) lanes[i] = null;
    lanes[lane] = null;

    const incoming: GraphEdge[] = [];
    for (let i = 0; i < above.length; i++) {
      if (above[i] === null) continue;
      incoming.push({ from: i, to: above[i] === commit.commitId ? lane : i });
    }

    // Route each parent: reuse a lane already heading there, else the node's
    // own lane for the first parent, else a free lane.
    const outgoing: GraphEdge[] = [];
    for (const [k, parent] of commit.parents.entries()) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = k === 0 ? lane : firstFree();
        lanes[target] = parent;
      }
      outgoing.push({ from: lane, to: target });
    }

    // Lanes that run straight through this row, unchanged.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && lanes[i] === above[i]) {
        outgoing.push({ from: i, to: i });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lane + 1, lanes.length, above.length);

    rows.push({
      lane,
      isMerge: commit.parents.length > 1,
      incoming,
      outgoing,
    });
  }

  return { rows, laneCount };
}

export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: LogEntry[];
  selected: string[];
  onSelect: (commitIds: string[]) => void;
}) {
  const chosen = new Set(selected);

  function toggle(commitId: string) {
    const next = new Set(chosen);
    if (next.has(commitId)) next.delete(commitId);
    else next.add(commitId);

    onSelect(
      commits
        .filter((commit) => next.has(commit.commitId))
        .map((commit) => commit.commitId),
    );
  }

  const { rows, laneCount } = layoutGraph(commits);
  const gutterWidth = laneCount * LANE_WIDTH;

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index] as GraphRow;
        const isSelected = chosen.has(commit.commitId);
        return (
          <button
            type="button"
            key={commit.commitId}
            onClick={() => toggle(commit.commitId)}
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
            <RowGraphic row={row} width={gutterWidth} />
            <CommitLabel commit={commit} />
          </button>
        );
      })}
    </div>
  );
}

function RowGraphic({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const middle = ROW_HEIGHT / 2;

  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      {row.incoming.map((edge) => (
        <line
          key={`in-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={0}
          x2={x(edge.to)}
          y2={middle}
          stroke={laneColor(edge.to)}
        />
      ))}
      {row.outgoing.map((edge) => (
        <line
          key={`out-${edge.from}-${edge.to}`}
          x1={x(edge.from)}
          y1={middle}
          x2={x(edge.to)}
          y2={ROW_HEIGHT}
          stroke={laneColor(edge.to)}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={middle}
        r={4}
        fill={row.isMerge ? "#fff" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
      />
    </svg>
  );
}
```

### Interdiff rows

One section per lined-up pair, in the order the backend sent them, which is the
order of the graphs that fed it. Each section is its own header and its own
patch, so a reader scrolls the comparison the way they scroll a branch.

A row with no files still renders, and says which kind of nothing it is. Two
commits that make the same change is the answer someone checking a rebase is
looking for; an empty commit on its own is not the same statement. That
branch lives here rather than in the controller, because it is per row and the
controller sees the list.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import type { InterdiffRow } from "../api";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({ rows }: { rows: InterdiffRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader from={row.from} to={row.to} />
          {row.files.length === 0 ? (
            <p style={{ padding: 12, fontStyle: "italic", color: "#666" }}>
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView files={row.files} />
          )}
        </section>
      ))}
    </div>
  );
}

function rowKey(row: InterdiffRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}
```

A test pins the lane arithmetic: a linear run stays in lane zero, and a
fork/merge diamond puts the merge on a hollow node and collapses the side
branch back to lane zero.

```tsx
//| id: frontend-view-commit-graph-test
//| file: src/frontend/views/CommitGraph.test.ts
import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../api";
import { layoutGraph } from "./CommitGraph";

function commit(id: string, parents: string[]): LogEntry {
  return { commitId: id, changeId: `${id}-change`, description: id, parents };
}

describe("layoutGraph", () => {
  test("keeps a linear history in one lane", () => {
    const { rows, laneCount } = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.some((r) => r.isMerge)).toBe(false);
  });

  test("splits a fork and collapses the merge back to lane zero", () => {
    const { rows, laneCount } = layoutGraph([
      commit("m", ["l", "r"]),
      commit("l", ["base"]),
      commit("r", ["base"]),
      commit("base", []),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(rows.map((r) => r.isMerge)).toEqual([true, false, false, false]);
    // the merge node fans a second parent out into lane one...
    expect(rows[0]?.outgoing).toContainEqual({ from: 0, to: 1 });
    // ...and the right side branch routes back into lane zero.
    expect(rows[2]?.outgoing).toContainEqual({ from: 1, to: 0 });
  });
});
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
  selected: string[];
  onSelect: (commitIds: string[]) => void;
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

### Interdiff

```tsx
//| id: frontend-controller-interdiff
//| file: src/frontend/controllers/Interdiff.tsx
import { useInterdiff } from "../state/interdiff";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function Interdiff({ from, to }: { from: string[]; to: string[] }) {
  const interdiff = useInterdiff(from, to);

  if (interdiff === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (interdiff.status === "loading") return <Message>Loading diff...</Message>;
  if (interdiff.status === "error") {
    return <Message tone="error">{interdiff.message}</Message>;
  }

  return <InterdiffRows rows={interdiff.data.rows} />;
}
```

## App

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { Interdiff } from "./controllers/Interdiff";
import { OperationLog } from "./controllers/OperationLog";
import { ReviewPanes } from "./views/ReviewPanes";

export function App() {
  const before = useSide();
  const after = useSide();

  return (
    <ReviewPanes
      before={<SidePicker side={before} />}
      after={<SidePicker side={after} />}
      diff={<Interdiff from={before.commits} to={after.commits} />}
    />
  );
}

interface Side {
  /** Operation to read this side's log at, or null for the live repo. */
  operation: string | null;
  /** Commit ids selected on this side, in log order. */
  commits: string[];
  selectOperation: (operationId: string | null) => void;
  selectCommits: (commitIds: string[]) => void;
}

function useSide(): Side {
  const [operation, setOperation] = useState<string | null>(null);
  const [commits, setCommits] = useState<string[]>([]);

  return {
    operation,
    commits,
    selectOperation(operationId) {
      setOperation(operationId);
      setCommits([]);
    },
    selectCommits: setCommits,
  };
}

function SidePicker({ side }: { side: Side }) {
  return (
    <>
      <OperationLog selected={side.operation} onSelect={side.selectOperation} />
      <CommitLog
        atOperation={side.operation}
        selected={side.commits}
        onSelect={side.selectCommits}
      />
    </>
  );
}
```
