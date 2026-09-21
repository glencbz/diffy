# Shell

The page, the root component, and the switch between the two screens.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack).
Bun's bundler finds the `<script>` and `<link>` tags and bundles them, along
with the React and JSX they pull in. `Bun.serve()` returns the bundle from `/`.
The stylesheet `<link>` is how the [stylesheet](index.md#styling) reaches the
page; every class the views name is defined there.

The icon is inline so that no route has to serve it.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Diffy</title>
    <link rel="stylesheet" href="./styles.css" />
    <link
      rel="icon"
      href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='6' rx='2' fill='%23cf222e'/><rect y='10' width='16' height='6' rx='2' fill='%231a7f37'/></svg>"
    />
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

## App

`App` calls `useSession()` once, alongside the two `useSide()` calls it
already owns, and passes it down to whichever `DiffPane` is on screen. One
session serves both screens, so a mark made on the local history is the same
record the pull request screen reads. `useSide` and
`SidePicker` are untouched. Wiring review state into the commit pickers would
mean threading it through `CommitLog` and `CommitGraph` too, for a graph that
shows nothing about review state and has no requested feature that would use
it.

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { OperationLog } from "./controllers/OperationLog";
import { PullRequests } from "./controllers/PullRequests";
import { useSession } from "./state/session";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { ReviewPanes } from "./views/ReviewPanes";

/** The repository the pull request screen reads. Next up for configuring. */
const REPO = "glencbz/diffy";

export function App() {
  const [mode, setMode] = useState<Mode>("local");
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });
  const session = useSession();

  return (
    <div className="app">
      <ModeTabs mode={mode} onSelect={setMode} />
      {mode === "local" ? (
        <ReviewPanes
          before={<SidePicker side={before} />}
          after={<SidePicker side={after} />}
          diff={
            <DiffPane
              comparison={{
                kind: "jj",
                from: before.commits,
                to: after.commits,
              }}
              session={session}
            />
          }
        />
      ) : (
        <PullRequests repo={REPO} session={session} />
      )}
    </div>
  );
}

interface Side<S extends Source> {
  /** Where this side's commits come from. */
  source: S;
  /** Commit ids selected on this side, in log order. */
  commits: string[];
  selectSource: (source: S) => void;
  selectCommits: (commitIds: string[]) => void;
}

function useSide<S extends Source>(initial: S): Side<S> {
  const [source, setSource] = useState<S>(initial);
  const [commits, setCommits] = useState<string[]>([]);

  return {
    source,
    commits,
    selectSource(next) {
      setSource(next);
      setCommits([]);
    },
    selectCommits: setCommits,
  };
}

function SidePicker({ side }: { side: Side<JjSource> }) {
  return (
    <>
      <OperationLog
        selected={side.source.operation}
        onSelect={(operation) => side.selectSource({ kind: "jj", operation })}
      />
      <CommitLog
        source={side.source}
        selected={side.commits}
        onSelect={side.selectCommits}
      />
    </>
  );
}
```

The window is a column: a tab strip that does not scroll, and under it
whichever screen is chosen. The body's default margin goes, because a
full-height app measured in `vh` inside an eight-pixel margin is sixteen
pixels taller than the window and scrolls when it should not.

`min-height: 0` appears here and on every flex ancestor of a scrolling pane,
because a flex item defaults to `min-height: auto`, which refuses to shrink
below its content and pushes the overflow out of the window instead of into a
scrollbar. It is the one rule in the stylesheet that is a workaround rather
than a decision.

```css
/*| id: design-app
@layer components {
  body {
    margin: 0;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-mono);
    font-size: var(--text-size);
    color: var(--text);
    background: var(--surface);
  }
}
```
## Mode tabs

Two screens, one strip. The tabs sit above everything, because the choice they
make is which history is being read, and that governs the whole window.

```tsx
//| id: frontend-view-mode-tabs
//| file: src/frontend/views/ModeTabs.tsx
export type Mode = "local" | "pulls";

const CAPTIONS: Record<Mode, string> = {
  local: "Local history",
  pulls: "Pull requests",
};

export function ModeTabs({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}) {
  return (
    <nav className="tabs">
      {(Object.keys(CAPTIONS) as Mode[]).map((candidate) => (
        <button
          type="button"
          key={candidate}
          onClick={() => onSelect(candidate)}
          className={candidate === mode ? "tab tab--current" : "tab"}
          aria-current={candidate === mode}
        >
          {CAPTIONS[candidate]}
        </button>
      ))}
    </nav>
  );
}
```

The strip takes its own height and no more, so the screen under it gets
everything left over however tall the window is. A tab is a button dressed as
a tab rather than a link, because choosing a screen changes no address.

```css
/*| id: design-mode-tabs
@layer components {
  .tabs {
    display: flex;
    flex: none;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .tab {
    padding: var(--space-3) var(--space-6);
    font: inherit;
    color: var(--text);
    cursor: pointer;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
  }

  .tab:hover {
    background: var(--surface-sunken);
  }

  .tab--current {
    font-weight: bold;
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
}
```

## Message

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
    <p className={tone === "error" ? "message message--error" : "message"}>
      {children}
    </p>
  );
}
```

The only variable is whether the news is bad. `.message--error` is the single
modifier that recolours it, leaving the ordinary case as plain body text.

```css
/*| id: design-message
@layer components {
  .message {
    padding: var(--space-5);
    color: var(--text);
  }

  .message--error {
    color: var(--danger);
  }
}
```
