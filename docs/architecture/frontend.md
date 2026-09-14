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
- `views/` imports React, other `views/`, and *types* from `api.ts` and
  `state/`. A view is written against a view model — `ReviewedRow`,
  `RowReview` — as often as it is written against a wire type, and a
  type-only import erases at compile time, so pulling one in from `state/`
  adds no runtime coupling to fetch or React state. Importing a *function*
  from `state/` would be the real boundary violation; the line is drawn at
  values, not at where a name is declared.
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

`/api/session` mirrors the backend's own schemas exactly — [`Mark`, `Comment`, and the discriminated `SessionEdit`](backend/review.md) all come straight from `review.md`, so a shape change there is a compile error here rather than a mismatch discovered at runtime. `postJson` is `getJson`'s write-side counterpart: same non-ok handling, same `ErrorResponse` parse, but nothing to return, since the caller already knows what it sent and `handleSessionEdit` answers with an empty 204 either way.

```ts
//| id: frontend-api

const Comparison = z.object({
  changeId: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Comment = z.object({
  id: z.string(),
  changeId: z.string(),
  path: z.string(),
  line: z.number().int(),
  commitId: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const SessionDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
});
export type SessionDocument = z.infer<typeof SessionDocument>;

export const SessionEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mark"), ...Mark.shape }),
  z.object({ kind: z.literal("unmark"), ...Comparison.shape }),
  z.object({ kind: z.literal("comment"), comment: Comment }),
  z.object({
    kind: z.literal("resolveComment"),
    id: z.string(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal("dropComment"), id: z.string() }),
]);
export type SessionEdit = z.infer<typeof SessionEdit>;

/** POST a JSON body, turning a non-ok response into its `error` message. */
async function postJson(
  url: string,
  body: unknown,
  label: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;

  const parsed = ErrorResponse.safeParse(await res.json());
  throw new Error(
    parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
  );
}

export async function fetchSession(): Promise<SessionDocument> {
  return SessionDocument.parse(
    await getJson("/api/session", "GET /api/session"),
  );
}

export async function postSessionEdit(edit: SessionEdit): Promise<void> {
  return postJson("/api/session", edit, "POST /api/session");
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

### Review state

`/api/interdiff` must never learn that review state exists. Every row it
returns costs a `jj` process, so a mark that triggered a refetch would spawn a
subprocess to record a click. Instead the session document loads once and the
interdiff loads on its own schedule; whichever row a mark or comment belongs
to is worked out here, client-side, from ids both responses already carry.
This is the same design already argued for [on the backend](backend/review.md)
— the module just moves.

`rowChangeId` picks `row.to?.changeId ?? row.from?.changeId`: the after side
is the version being approved, so when a row has a real after side that is the
identity that counts. `alignSeries` guarantees at least one side is present,
so this is total.

The obvious way to ask "has this row been reviewed" is "is there a mark with
this row's change id", and it is wrong. `alignSeries` can put one change id on
two different rows in the same series — a reorder is a drop and an insert of
the same change — and a mark on one must not paint the other as reviewed or
even as changed, because they are different comparisons that only share an
identity by coincidence of the algorithm. The exact check the backend already
made this argument for — key on the full `(changeId, fromCommitId,
toCommitId)` triple, not the change id alone — has to be repeated on read, not
just on write: `reviewed` needs an exact triple match, and `changed` needs
more than a shared change id, or the same bug just resurfaces one layer up. A
mark counts toward `changed` when it fills the same sides as the row, or when
it literally shares one: the same `fromCommitId` because an amend moved the
after side, or the same `toCommitId` because a rebase moved the before side.
Sharing a side alone is not enough, because a rebase that rewrites both sides
at once shares neither, and reporting a change the reader has already looked
at as `unseen` loses the very memory the session exists to keep. Filling the
same sides alone is not enough either, because a change that was a
modification and is now a drop fills different slots while plainly being the
same thing the reader reviewed. The two together leave exactly one pair
unrelated, which is the pair that must be: the drop half of a reorder
(`from: A, to: null`) and its insert half (`from: null, to: A`) neither share
a side nor fill the same slots, so a mark on one leaves the other `unseen`,
which is what a reader actually wants, since the insert is a comparison they
have never looked at.

A comment's `stale` flag answers a narrower question than a mark's `changed`
state: not "has this row moved on" but "does this specific line still mean
what it meant when the note was written". A comment's `commitId` names the
version its line number was read against; it is stale when neither of the
row's current sides is that commit.

```ts
//| id: frontend-state-review
//| file: src/frontend/state/review.ts
import type {
  Comment,
  InterdiffRow,
  Mark,
  SessionDocument,
  SessionEdit,
} from "../api";

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

export interface RowComment extends Comment {
  stale: boolean;
}

export interface ReviewedRow extends InterdiffRow {
  changeId: string;
  review: RowReview;
  comments: RowComment[];
}

export function rowChangeId(row: InterdiffRow): string {
  const changeId = row.to?.changeId ?? row.from?.changeId;
  if (changeId === undefined) {
    throw new Error("interdiff row has no commit on either side");
  }
  return changeId;
}

function latestMark(marks: Mark[]): Mark | null {
  return marks.reduce<Mark | null>(
    (latest, mark) =>
      latest === null || mark.seenAt > latest.seenAt ? mark : latest,
    null,
  );
}

/** Whether a mark describes the same comparison slot: both sides, or which
 * single side, the row fills. A reorder's drop and insert halves fill
 * opposite slots, so neither can speak for the other. */
function fillsSameSides(
  mark: Mark,
  fromCommitId: string | null,
  toCommitId: string | null,
): boolean {
  return (
    (mark.fromCommitId === null) === (fromCommitId === null) &&
    (mark.toCommitId === null) === (toCommitId === null)
  );
}

function reviewFor(
  marksForChange: Mark[],
  fromCommitId: string | null,
  toCommitId: string | null,
): RowReview {
  const exact = marksForChange.find(
    (mark) =>
      mark.fromCommitId === fromCommitId && mark.toCommitId === toCommitId,
  );
  if (exact !== undefined) return { state: "reviewed", seenAt: exact.seenAt };

  const related = marksForChange.filter(
    (mark) =>
      fillsSameSides(mark, fromCommitId, toCommitId) ||
      mark.fromCommitId === fromCommitId ||
      mark.toCommitId === toCommitId,
  );
  const latest = latestMark(related);
  if (latest === null) return { state: "unseen" };
  return {
    state: "changed",
    seenAt: latest.seenAt,
    seenFrom: latest.fromCommitId,
    seenTo: latest.toCommitId,
  };
}

export function reviewRows(
  rows: InterdiffRow[],
  document: SessionDocument,
): ReviewedRow[] {
  return rows.map((row) => {
    const changeId = rowChangeId(row);
    const fromCommitId = row.from?.commitId ?? null;
    const toCommitId = row.to?.commitId ?? null;
    const marksForChange = document.marks.filter(
      (mark) => mark.changeId === changeId,
    );

    const comments = document.comments
      .filter((comment) => comment.changeId === changeId)
      .map((comment) => ({
        ...comment,
        stale:
          comment.commitId !== fromCommitId && comment.commitId !== toCommitId,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      ...row,
      changeId,
      review: reviewFor(marksForChange, fromCommitId, toCommitId),
      comments,
    };
  });
}

function sameComparison(
  a: {
    changeId: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
  b: {
    changeId: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
): boolean {
  return (
    a.changeId === b.changeId &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}

/**
 * The client's half of a mutation: apply an edit to a local copy of the
 * document the same way the backend's SQL would, so the optimistic update
 * and the eventual server state never need reconciling.
 */
export function applyEdit(
  document: SessionDocument,
  edit: SessionEdit,
): SessionDocument {
  switch (edit.kind) {
    case "mark": {
      const mark: Mark = {
        changeId: edit.changeId,
        fromCommitId: edit.fromCommitId,
        toCommitId: edit.toCommitId,
        seenAt: edit.seenAt,
      };
      return {
        ...document,
        marks: [
          ...document.marks.filter((m) => !sameComparison(m, mark)),
          mark,
        ],
      };
    }

    case "unmark":
      return {
        ...document,
        marks: document.marks.filter((m) => !sameComparison(m, edit)),
      };

    case "comment":
      return {
        ...document,
        comments: [
          ...document.comments.filter((c) => c.id !== edit.comment.id),
          edit.comment,
        ],
      };

    case "resolveComment":
      return {
        ...document,
        comments: document.comments.map((c) =>
          c.id === edit.id ? { ...c, resolved: edit.resolved } : c,
        ),
      };

    case "dropComment":
      return {
        ...document,
        comments: document.comments.filter((c) => c.id !== edit.id),
      };
  }
}
```

The reorder case is the one worth a real fixture rather than a hand-rolled
one: it runs `alignSeries` for real, because the bug this schema guards
against is specifically in how `alignSeries`'s output gets turned into review
state, and a fixture written by hand could accidentally encode the same wrong
assumption the code is being tested against. The last test applies one edit
through this module's `applyEdit` and through the backend's `applyEdit` +
`readSession`, and asserts the two documents agree — the whole point of
generating `id` and every timestamp client-side is that there is exactly one
correct answer for what the document should contain, and both sides are
expected to reach it independently.

```ts
//| id: frontend-state-review-test
//| file: src/frontend/state/review.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alignSeries } from "../../backend/commit/series";
import {
  applyEdit as applyServerEdit,
  readSession,
} from "../../backend/review/session";
import type {
  InterdiffRow,
  LogEntry,
  SessionDocument,
  SessionEdit,
} from "../api";
import { applyEdit, reviewRows } from "./review";

function logEntry(changeId: string, commitId: string): LogEntry {
  return { changeId, commitId, description: "", parents: [] };
}

function pairRow(
  changeId: string,
  fromCommitId: string,
  toCommitId: string,
): InterdiffRow {
  return {
    from: logEntry(changeId, fromCommitId),
    to: logEntry(changeId, toCommitId),
    files: [],
  };
}

describe("reviewRows", () => {
  test("leaves a row unseen against an empty document", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = { marks: [], comments: [] };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a row reviewed on an exact triple match", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [
        {
          changeId: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("marks a row changed when the after side has moved on", () => {
    // arrange
    const row = pairRow("a", "a1", "a3");
    const document: SessionDocument = {
      marks: [
        {
          changeId: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when the before side has moved on", () => {
    // arrange
    const row = pairRow("a", "a0", "a2");
    const document: SessionDocument = {
      marks: [
        {
          changeId: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when a rebase moved both sides at once", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: SessionDocument = {
      marks: [
        {
          changeId: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("leaves the other half of a reorder unseen, not changed", () => {
    // arrange
    const A = logEntry("aaaa", "a1");
    const B = logEntry("bbbb", "b1");
    const rows = alignSeries([A, B], [B, A]).map((pair) => ({
      ...pair,
      files: [],
    }));
    const changeARows = reviewRows(rows, { marks: [], comments: [] }).filter(
      (row) => row.changeId === "aaaa",
    );
    const dropped = changeARows.find((row) => row.to === null);
    if (dropped === undefined) {
      throw new Error("expected a dropped row for change aaaa");
    }
    const document: SessionDocument = {
      marks: [
        {
          changeId: "aaaa",
          fromCommitId: dropped.from?.commitId ?? null,
          toCommitId: dropped.to?.commitId ?? null,
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const inserted = reviewRows(rows, document).find(
      (row) => row.changeId === "aaaa" && row.from === null,
    );

    // assert
    expect(rows).toHaveLength(3);
    expect(changeARows).toHaveLength(2);
    expect(inserted?.review).toEqual({ state: "unseen" });
  });

  test("flags a comment stale when its commit is on neither side of the row", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          changeId: "a",
          path: "f.ts",
          line: 3,
          commitId: "a0",
          body: "old",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });
});

describe("applyEdit", () => {
  test("matches the document the backend would produce for the same edit", () => {
    // arrange
    process.env.DIFFY_SESSION_DB = join(
      mkdtempSync(join(tmpdir(), "diffy-review-state-")),
      "session.sqlite",
    );
    const edit: SessionEdit = {
      kind: "mark",
      changeId: "a",
      fromCommitId: "a1",
      toCommitId: "a2",
      seenAt: "2026-09-14T09:00:00.000Z",
    };

    // act
    const client = applyEdit({ marks: [], comments: [] }, edit);
    applyServerEdit(edit);

    // assert
    expect(client).toEqual(readSession());
  });
});
```

### Session

`useSession` loads the document once and hands back four mutators plus the
document and an error string. It deliberately does not return an
`AsyncState<SessionDocument>`: "not loaded yet" and "nothing reviewed yet" are
both an empty document and render identically, so a status union would only
force a branch with no distinct output on either arm. `document` starts as the
empty document rather than `null` for the same reason — an empty session is a
valid session, not a pending one.

Each mutator builds the `SessionEdit` itself — it mints `id` with
`crypto.randomUUID()` and every timestamp with `new Date().toISOString()`, the
same way the backend would have generated them had the round trip gone the
other way. That is what makes the optimistic update exact rather than
provisional: `applyEdit` runs against the local document immediately, the same
edit value goes out over `postSessionEdit`, and there is nothing to
reconcile when the response comes back, because there is no separate
server-generated value to reconcile against. `markSeen` decides `mark` versus
`unmark` from the row's own `review.state`, so callers never construct the
edit by hand.

A failed POST leaves the optimistic update in place, sets `error`, and
re-fetches the document to snap back to server truth — simpler than trying to
undo one edit out of a sequence that may already have more edits queued behind
it. Every mutator is wrapped in `useCallback` so that passing `markSeen`
straight through two layers of props does not retrigger effects that depend on
it.

```tsx
//| id: frontend-state-session
//| file: src/frontend/state/session.ts
import { useCallback, useEffect, useState } from "react";
import {
  fetchSession,
  postSessionEdit,
  type SessionDocument,
  type SessionEdit,
} from "../api";
import { applyEdit, type ReviewedRow } from "./review";

const EMPTY_DOCUMENT: SessionDocument = { marks: [], comments: [] };

export interface Session {
  document: SessionDocument;
  error: string | null;
  markSeen: (row: ReviewedRow) => void;
  addComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
}

export function useSession(): Session {
  const [document, setDocument] = useState<SessionDocument>(EMPTY_DOCUMENT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchSession()
      .then((data) => {
        if (live) setDocument(data);
      })
      .catch((err: unknown) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback((edit: SessionEdit) => {
    setDocument((current) => applyEdit(current, edit));
    postSessionEdit(edit).catch((err: unknown) => {
      setError(String(err));
      fetchSession()
        .then((data) => setDocument(data))
        .catch((refetchErr: unknown) => setError(String(refetchErr)));
    });
  }, []);

  const markSeen = useCallback(
    (row: ReviewedRow) => {
      const comparison = {
        changeId: row.changeId,
        fromCommitId: row.from?.commitId ?? null,
        toCommitId: row.to?.commitId ?? null,
      };
      submit(
        row.review.state === "reviewed"
          ? { kind: "unmark", ...comparison }
          : { kind: "mark", ...comparison, seenAt: new Date().toISOString() },
      );
    },
    [submit],
  );

  const addComment = useCallback(
    (row: ReviewedRow, path: string, line: number, body: string) => {
      submit({
        kind: "comment",
        comment: {
          id: crypto.randomUUID(),
          changeId: row.changeId,
          path,
          line,
          commitId: row.to?.commitId ?? row.from?.commitId ?? "",
          body,
          resolved: false,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [submit],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) =>
      submit({ kind: "resolveComment", id, resolved }),
    [submit],
  );

  const dropComment = useCallback(
    (id: string) => submit({ kind: "dropComment", id }),
    [submit],
  );

  return { document, error, markSeen, addComment, resolveComment, dropComment };
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

A third line adds review state to that same job: whether the row has been
looked at, whether it moved since, and how many open comments sit on it. The
`mark seen` / `mark unseen` button reads its own label off
`row.review.state`, so the caller never has to compute which action is
current — it just wires the click through.

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { CSSProperties, ReactNode } from "react";
import type { LogEntry } from "../api";
import type { ReviewedRow, RowReview } from "../state/review";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  row,
  onMarkSeen,
}: {
  row: ReviewedRow;
  onMarkSeen: () => void;
}) {
  const openComments = row.comments.filter(
    (comment) => !comment.resolved,
  ).length;

  return (
    <header
      style={{
        padding: "8px 12px",
        background: "#fafafa",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Row caption="before" commit={row.from} />
      <Row caption="after" commit={row.to} />
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}
      >
        <ReviewChip review={row.review} />
        {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
        <button type="button" onClick={onMarkSeen} style={{ font: "inherit" }}>
          {row.review.state === "reviewed" ? "mark unseen" : "mark seen"}
        </button>
      </div>
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

function ReviewChip({ review }: { review: RowReview }) {
  if (review.state === "unseen") return null;
  return review.state === "reviewed" ? (
    <Chip tone="reviewed">reviewed</Chip>
  ) : (
    <Chip tone="changed">changed since you looked</Chip>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  const toneStyle: Record<typeof tone, CSSProperties> = {
    reviewed: {
      background: "#edf7ed",
      color: "#2b6a2b",
      border: "1px solid #a8d5a8",
    },
    changed: {
      background: "#fdf5e3",
      color: "#8a5a00",
      border: "1px solid #e6c98a",
    },
    open: {
      background: "#fdecec",
      color: "#a01b1b",
      border: "1px solid #e6a8a8",
    },
  };
  return (
    <span
      style={{
        fontSize: 11,
        padding: "0 5px",
        borderRadius: 8,
        lineHeight: "15px",
        ...toneStyle[tone],
      }}
    >
      {children}
    </span>
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

Rows take `ReviewedRow` now, not the bare wire `InterdiffRow`, and thread the
four session callbacks down to `ComparisonHeader` and `DiffView`. `rowKey`
stays keyed on commit ids exactly as before: [a reordered series can put the
same change id on two rows](#review-state), so the change id is not a unique
React key even though it is now sitting right there on the row.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import type { ReviewedRow } from "../state/review";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  onMarkSeen,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  rows: ReviewedRow[];
  onMarkSeen: (row: ReviewedRow) => void;
  onAddComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader row={row} onMarkSeen={() => onMarkSeen(row)} />
          {row.files.length === 0 ? (
            <p style={{ padding: 12, fontStyle: "italic", color: "#666" }}>
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView
              files={row.files}
              comments={row.comments}
              onAddComment={(path, line, body) =>
                onAddComment(row, path, line, body)
              }
              onResolveComment={onResolveComment}
              onDropComment={onDropComment}
            />
          )}
        </section>
      ))}
    </div>
  );
}

function rowKey(row: ReviewedRow): string {
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

A left gutter adds the after-side line number to each rendered line, because
that is what a comment's `line` field means: the line as it reads in the
version being approved, not an offset into the raw patch text. `gutterLines`
walks the patch once and carries a running counter, seeded by each `@@
-a,b +c,d @@` header's `c`. `diff --git`, `index `, `---`, `+++`, and hunk
header lines never had an after-side line to begin with; a `-` line was
removed, so it has no line in the after side either. Both of those show a
blank gutter and are not clickable — there is nothing on that line in the
version a comment would be anchored to.

Clicking a commentable line opens a composer for it — a plain `<form>`, one
`useState<{path, line} | null>` for which line's composer is open, closed
again on submit or cancel. Comment threads render under the file's `<pre>`,
not in the gutter: a gutter-anchored thread would have to reflow around
variable-height content on every keystroke, and the patch is already the
thing being read top to bottom, so a comment reads as the next thing under the
line it is about rather than squeezed beside it. A stale thread — its
`commitId` matching neither side of the row — says so in place, because the
line number next to it may no longer be the line the comment was written
about.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import { type CSSProperties, useState } from "react";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";

export function DiffView({
  files,
  comments,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  files: FileDiff[];
  comments: RowComment[];
  onAddComment: (path: string, line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  const [composer, setComposer] = useState<{
    path: string;
    line: number;
  } | null>(null);

  return (
    <div style={{ padding: 12 }}>
      {files.map((file) => {
        const path = pathOf(file);
        return (
          <FileRow
            key={path}
            file={file}
            comments={comments.filter((comment) => comment.path === path)}
            composerLine={composer?.path === path ? composer.line : null}
            onOpenComposer={(line) => setComposer({ path, line })}
            onCancelComposer={() => setComposer(null)}
            onSubmitComposer={(line, body) => {
              onAddComment(path, line, body);
              setComposer(null);
            }}
            onResolveComment={onResolveComment}
            onDropComment={onDropComment}
          />
        );
      })}
    </div>
  );
}

function FileRow({
  file,
  comments,
  composerLine,
  onOpenComposer,
  onCancelComposer,
  onSubmitComposer,
  onResolveComment,
  onDropComment,
}: {
  file: FileDiff;
  comments: RowComment[];
  composerLine: number | null;
  onOpenComposer: (line: number) => void;
  onCancelComposer: () => void;
  onSubmitComposer: (line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
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
          {gutterLines(file.patch).map(({ text, afterLine }, index) => (
            <PatchLine
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
              key={index}
              text={text}
              afterLine={afterLine}
              onOpenComposer={onOpenComposer}
            />
          ))}
        </pre>
      )}
      {composerLine !== null && (
        <CommentComposer
          line={composerLine}
          onCancel={onCancelComposer}
          onSubmit={onSubmitComposer}
        />
      )}
      {comments.length > 0 && (
        <div>
          {comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              onResolve={(resolved) => onResolveComment(comment.id, resolved)}
              onDrop={() => onDropComment(comment.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CommentComposer({
  line,
  onCancel,
  onSubmit,
}: {
  line: number;
  onCancel: () => void;
  onSubmit: (line: number, body: string) => void;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      style={{ padding: 8, borderTop: "1px solid #ccc", background: "#fafafa" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSubmit(line, body);
      }}
    >
      <div style={{ color: "#888", marginBottom: 4 }}>line {line}</div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        style={{ width: "100%", font: "inherit" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button type="submit">comment</button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

function CommentThread({
  comment,
  onResolve,
  onDrop,
}: {
  comment: RowComment;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
}) {
  return (
    <div
      style={{
        borderLeft: `3px solid ${comment.resolved ? "#63b363" : "#a01b1b"}`,
        padding: "6px 8px",
        margin: "4px 8px",
        opacity: comment.resolved ? 0.72 : 1,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, color: "#888" }}
      >
        <span>
          {comment.path}:{comment.line} ·{" "}
          {comment.resolved ? "resolved" : "open"}
        </span>
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        <button type="button" onClick={onDrop}>
          delete
        </button>
      </div>
      <div>{comment.body}</div>
      {comment.stale && (
        <div style={{ color: "#8a5a00" }}>
          written against {comment.commitId.slice(0, 8)} — that line has since
          been rewritten
        </div>
      )}
    </div>
  );
}

const gutterStyle: CSSProperties = {
  width: 40,
  flex: "none",
  textAlign: "right",
  marginRight: 8,
  color: "#999",
  userSelect: "none",
};

const lineRowStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  font: "inherit",
  textAlign: "left",
};

/** A `<button>` when the line has an after-side line to comment on, a `<div>` otherwise — a static line is not interactive, so it is not a button. */
function PatchLine({
  text,
  afterLine,
  onOpenComposer,
}: {
  text: string;
  afterLine: number | null;
  onOpenComposer: (line: number) => void;
}) {
  const body = (
    <>
      <span style={gutterStyle}>{afterLine ?? ""}</span>
      <span style={{ color: lineColor(text) }}>{text === "" ? " " : text}</span>
    </>
  );

  if (afterLine === null) return <div style={lineRowStyle}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(afterLine)}
      style={{ ...lineRowStyle, cursor: "pointer" }}
    >
      {body}
    </button>
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

interface GutterLine {
  text: string;
  afterLine: number | null;
}

/** After-side line number per rendered patch line, or null where none applies. */
function gutterLines(patch: string): GutterLine[] {
  let afterLine: number | null = null;

  return patch.split("\n").map((text) => {
    if (
      text === "" ||
      text.startsWith("diff --git ") ||
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { text, afterLine: null };
    }

    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      afterLine = Number(hunk[1]);
      return { text, afterLine: null };
    }

    if (text.startsWith("-")) return { text, afterLine: null };

    if (afterLine === null) return { text, afterLine: null };
    const line = afterLine;
    afterLine += 1;
    return { text, afterLine: line };
  });
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

Takes a `session` prop rather than calling `useSession` itself, since `App`
owns the one session for the whole page and this controller is not the only
thing that will eventually read it. The existing null/loading/error branches
on the interdiff fetch are untouched; `session.error` is a second, independent
error that can appear on top of a perfectly good diff, so it renders above the
rows rather than replacing them. `reviewRows` runs below those early returns
as a plain function call — it is a pure derivation of props already in hand,
not a fetch, so it earns no hook of its own.

```tsx
//| id: frontend-controller-interdiff
//| file: src/frontend/controllers/Interdiff.tsx
import { useInterdiff } from "../state/interdiff";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function Interdiff({
  from,
  to,
  session,
}: {
  from: string[];
  to: string[];
  session: Session;
}) {
  const interdiff = useInterdiff(from, to);

  if (interdiff === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (interdiff.status === "loading") return <Message>Loading diff...</Message>;
  if (interdiff.status === "error") {
    return <Message tone="error">{interdiff.message}</Message>;
  }

  return (
    <>
      {session.error !== null && (
        <Message tone="error">{session.error}</Message>
      )}
      <InterdiffRows
        rows={reviewRows(interdiff.data.rows, session.document)}
        onMarkSeen={session.markSeen}
        onAddComment={session.addComment}
        onResolveComment={session.resolveComment}
        onDropComment={session.dropComment}
      />
    </>
  );
}
```

## App

`App` calls `useSession()` once, alongside the two `useSide()` calls it
already owns, and passes it straight through to `Interdiff`. `useSide` and
`SidePicker` are untouched: wiring review state into the commit pickers would
mean threading it through `CommitLog` and `CommitGraph` as well, for a graph
that does not currently show anything about review state and has no requested
feature that would use it. That stays out of scope on purpose rather than
speculatively wired up.

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { Interdiff } from "./controllers/Interdiff";
import { OperationLog } from "./controllers/OperationLog";
import { useSession } from "./state/session";
import { ReviewPanes } from "./views/ReviewPanes";

export function App() {
  const before = useSide();
  const after = useSide();
  const session = useSession();

  return (
    <ReviewPanes
      before={<SidePicker side={before} />}
      after={<SidePicker side={after} />}
      diff={
        <Interdiff from={before.commits} to={after.commits} session={session} />
      }
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
