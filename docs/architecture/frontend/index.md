# Frontend

The review UI is a small [React](https://react.dev/) app with two screens.
**Local history** has a *before* and an *after* commit graph, each read at an
operation of its own, and a diff panel. Pick commits on each side and the
panel shows one interdiff row per pair [`alignSeries`](../backend/series.md)
lines up; a commit with nothing opposite shows its own diff, so reading a
single commit needs no separate mode. **Pull requests** is the same
comparison over a pull request's force-pushed heads.

## Architecture

The app has seven layers plus a root. Imports point one way down this list:

```
index.html + main.tsx   mount point
        |
      App.tsx            root, provides the shared state and routes
        |
    screens/             lay out one tab's screen
        |
   controllers/          wire a state hook to a view
      /       \
 state/        views/    state/ owns data and keeps it loaded
    |   \         |      views/ turn props into markup
    | persistence/ |     persistence/: what the browser keeps between visits
    |         \    |
 api.ts        \   |     api.ts: transport, fetch plus Zod, no React
       \        \  |
        `------ model/   model/: the app's own shapes and defaults
```

Documents are cut by feature, not by layer: each holds that feature's state,
controller, and views, and tangles them out into their layers' folders. The
source tree answers what may import what; the document tree answers what you
are changing.

### transport

`api.ts` holds one Zod schema and one wrapper per endpoint and parses every
response, so a backend shape drifting fails at the fetch with a named error
rather than reaching a view as `undefined`. Wrappers return `model/` types.
Commits are named by id, never a revset or change id, because an id means the
same commit at every operation; an optional `atOperation` reads history at
that operation. See [transport](transport.md).

### state

Each `state/` module owns one slice of data and keeps it loaded: the
fetch-on-change-and-cancel `useEffect` lives here and nowhere else. Every hook
returns an `AsyncState<T>`, so a caller has to handle loading and error.

### views

A view is a pure function from props to markup; a test renders it with
fixture props and mocks nothing. Views take `model/` shapes directly. Add
view-model types only once the UI stops showing what the API returns.

A view starts as one file named for it, holding the view and any small
helpers only it uses. Once a part of it earns a heading of its own in the
feature doc, the view becomes a directory named for it: the view in a file of
the same name, each such part a file beside it, a helper the parts share a
file beside them, and a part with parts of its own a directory again. A view more than one directory draws sits at the
lowest level that holds all of its callers. The main file is not
`index.tsx`, which would fill editor tabs and stack traces with index files.

Code outside a view's directory imports its main component and nothing else.
A shape its callers name, such as a props type they build, lives in `model/`;
a helper they reach for means the component should take the input and work
it out itself.

A `ReactNode` slot is for what a caller composes from its own state: a
controller's loading message, or two views wired to the same state. A slot
only ever filled with one view is that view's data sent the long way round.
Take the data and draw the view inside, so the view nests and the caller
imports one thing less.

The feature doc follows the same cut: each part is a block under a heading
that names it, with the prose for that part directly above the block.
[Diff view](diff.md#diff-view) is laid out this way.

### model

`model/` holds the app's types, document schemas and defaults, and the pure
functions that read and change them, including the backend's shapes. It
touches no state, storage, or browser API. Any rule worth a test lives here
rather than in a hook.

### persistence

A `persistence/` module is a repository for one document kept between visits
and decides where it lives: settings in `localStorage`, the
[review document](review.md#storage) on the server. ("Repository" is the
storage pattern; the reviewed repository is spelled `repo`.)

### controllers

A controller wires one state hook to one view and renders the view or a
`Message`; it has no markup of its own. `PullReview` mounts several, because
nothing can be asked for until the pull request's history says which head is
latest.

### screens

A screen is everything one tab draws. It reads `App`'s contexts, calls the
hooks only it needs, and holds how the reader has arranged it. Screens share
no frame, so each reads top to bottom on its own.

### root

`App.tsx` holds what outlives a screen, each in a context:
[settings](settings.md#sharing-the-settings), the
[review document](review.md#holding-it-while-it-changes), and
[local history](local-history.md#polling-the-operation-log). Where the reader
is (tab, pull request, heads, commit, file, line) is the
[address](address.md), read through `usePlace`.

### Keeping the boundary honest

The import rule is a convention kept in review. An import that does not fit
below means the code is in the wrong layer; move the code rather than add an
exception.

Allowed import edges:

- `api.ts` imports Zod and `model/`. `model/` imports Zod and other `model/`
  modules, never `api.ts`.
- The server's [review store](../backend/review-store.md) imports
  `model/review.ts`, so browser and server apply a command with the same
  function.
- `model/pairing.ts` imports the pure `alignSeries` from
  `../../backend/commit/series`.
- `persistence/` imports `model/` and other `persistence/` modules. It is the
  only layer that touches `localStorage`, and the only one besides `api.ts`
  that talks to the server.
- `state/` imports React, `api.ts`, `persistence/`, `model/`, and other
  `state/` modules.
- `views/` imports React, other `views/`, and `model/`. A view never
  imports `state/` or `api.ts`; a shape it names lives in `model/`.
- `controllers/` import `state/`, `views/`, and `model/`.
- `screens/` import `controllers/`, `state/`, `views/`, and `model/`.
- `App.tsx` imports `screens/`, `model/`, and the `state/` hooks and
  contexts for what it holds above the screens.

## Styling

The stylesheet is a stack of [cascade layers][layers], declared once by the
`@layer` statement below, so a rule's layer decides what wins before
specificity does.

[layers]: https://developer.mozilla.org/en-US/docs/Web/CSS/@layer

- **Primitives** are raw ramps (`--grey-300`).
- **Roles** map a primitive to a job (`--border`). Components name roles,
  never primitives, so retheming is an edit here.
- **Metrics** are the tunable lengths: spacing, type sizes, column widths.
- **Settings** rebinds metrics to the reader's
  [choices](settings.md#display), above `metrics-narrow` so a choice beats a
  breakpoint.
- **Components** are the views' classes.

`roles-dark`, `metrics-narrow`, and `components-narrow` refine the layer below
them under one condition each. Giving each refinement its own layer means no
rule depends on being read second. Primitives, roles, metrics, and dark mode
live in [Design tokens](tokens.md); a component's rules live in the document
with its markup. The references below are an inventory, not an order.

```css
/*| id: stylesheet
/*| file: src/frontend/styles.css
@layer primitives,
  roles,
  roles-dark,
  metrics,
  metrics-narrow,
  settings,
  components,
  components-narrow;

<<design-primitives>>

<<design-roles>>

<<design-dark>>

<<design-metrics>>

<<design-responsive-metrics>>

<<design-text-size>>

<<design-app>>

<<design-settings>>

<<design-mode-tabs>>

<<design-panes>>

<<design-splitter>>

<<design-commit-drawer>>

<<design-pane-tabs>>

<<design-message>>

<<design-operation-picker>>

<<design-newer-operation>>

<<design-interdiff-toggle>>

<<design-commit-label>>

<<design-comparison-header>>

<<design-review-state>>

<<design-commit-graph>>

<<design-paired-graph>>

<<design-interdiff-rows>>

<<design-file-tree>>

<<design-file-navigator>>

<<design-diff-view>>

<<design-syntax>>

<<design-pull-state-chip>>

<<design-pull-list>>

<<design-local-review-list>>

<<design-register-strip>>

<<design-pull-header>>

<<design-pull-comparison-picker>>

<<design-last-reviewed>>

<<design-pull-sheet>>

<<design-commit-message>>

<<design-commit-stack>>

<<design-responsive-panes>>
```

## Async state

```ts
//| id: frontend-model-async-state
//| file: src/frontend/model/asyncState.ts
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
```

## Local storage

`localRepository` keeps a document as JSON under one `localStorage` key. A
repository loads and saves the whole document rather than a method per
change, so each change's logic stays in the model where it can be tested
without a storage stand-in.

```ts
//| id: frontend-persistence-local
//| file: src/frontend/persistence/local.ts
import type * as z from "zod";

/** Loads and saves one document the app keeps between visits. */
export interface Repository<T> {
  load(): T;
  save(document: T): void;
}

/** A document kept as JSON under one `localStorage` key. A read that finds
 * nothing it can parse returns `empty`, and a write that throws is dropped. */
export function localRepository<T>(
  key: string,
  schema: z.ZodType<T>,
  empty: T,
): Repository<T> {
  return {
    load() {
      const raw = localStorage.getItem(key);
      if (raw === null) return empty;

      // Absent, truncated by a full quota, or hand-edited: costs the reader
      // what was stored, not the ability to open the app. A field added later
      // needs a schema default, or every older document reads as bad.
      try {
        return schema.parse(JSON.parse(raw));
      } catch {
        return empty;
      }
    },
    save(document) {
      try {
        localStorage.setItem(key, JSON.stringify(document));
      } catch {
        // Safari private browsing and full quotas throw, and the caller is a
        // click handler with no error channel. Keep working for this tab.
      }
    },
  };
}
```

`useStored` is where a state hook meets a repository. Its `update` closes over
nothing that changes, so callbacks built on it can pass down several layers
without retriggering effects.

```ts
//| id: frontend-state-stored
//| file: src/frontend/state/stored.ts
import { useCallback, useState } from "react";
import type { Repository } from "../persistence/local";

export type Update<T> = (compute: (current: T) => T) => void;

/** A document held in React state and saved through `repository` on every
 * change. */
export function useStored<T>(repository: Repository<T>): [T, Update<T>] {
  const [document, setDocument] = useState<T>(() => repository.load());

  const update = useCallback<Update<T>>(
    (compute) => {
      setDocument((current) => {
        const next = compute(current);
        repository.save(next);
        return next;
      });
    },
    [repository],
  );

  return [document, update];
}
```

`bun test` has no `localStorage`, so repository tests install this stand-in.

```ts
//| id: frontend-persistence-memory-storage
//| file: src/frontend/persistence/memoryStorage.ts
export function memoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}
```

```ts
//| id: frontend-persistence-local-test
//| file: src/frontend/persistence/local.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { localRepository } from "./local";
import { memoryStorage } from "./memoryStorage";

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

const Counter = z.object({ count: z.number() });
const repository = localRepository("test.counter", Counter, { count: 0 });

describe("load", () => {
  test("round-trips a document through save", () => {
    // arrange
    repository.save({ count: 3 });

    // act
    // assert
    expect(repository.load()).toEqual({ count: 3 });
  });

  test("loads the empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
  });

  test("loads the empty document when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("test.counter", "not json");

    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
  });

  test("loads the empty document when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("test.counter", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(repository.load()).toEqual({ count: 0 });
  });
});

describe("save", () => {
  test("does not throw when the store throws", () => {
    // arrange
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;

    // act
    // assert
    expect(() => repository.save({ count: 1 })).not.toThrow();
  });
});
```
