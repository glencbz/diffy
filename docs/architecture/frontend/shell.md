# Shell

The page, the root component, and the switch between the two screens.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack).
Bun's bundler finds the `<script>` and `<link>` tags and bundles them, along
with the React and JSX they pull in. `Bun.serve()` returns the bundle from `/`.
The stylesheet `<link>` is how the [stylesheet](index.md#styling) reaches the
page; every class the views name is defined there.

The icon is inline so that no route has to serve it.

The viewport tag is what makes a phone a narrow window. Without it a mobile
browser lays the page out 980 pixels wide and shrinks the result to fit the
screen, so 13-pixel text reaches the reader at about five pixels and the phone
breakpoints never match. `width=device-width` lays the page out at the width
of the screen.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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

`App` provides what outlives a screen and picks the screen to draw. It knows
no screen's layout and no screen's props beyond the place it routes on.

Which screen is open is part of the [address](address.md), so `App` reads it
from `usePlace` rather than holding it in `useState`, hands each screen its
part of the place, and hands every screen `go` to leave it by. The `switch`
over `place.tab` is the routing table, and the type checker holds it to one
screen per tab.

Everything else `App` holds, it holds in a context, because it belongs to
more than one screen or has to survive the one that shows it unmounting:

- [`useSettings`](settings.md#sharing-the-settings), because a text size
  governs the whole window and the diff settings govern every diff on every
  screen. Calling it inside the settings screen would apply the reader's
  size only while that screen is open.
- [`useReview`](review.md#holding-it-while-it-changes), because one review
  document serves both screens that draw diffs, and loading it per screen
  would reload it on every switch of tab.
- [`useLocalHistory`](local-history.md#polling-the-operation-log), because
  the picks and ticks of a local review should still be there after a look
  at the settings.

What a screen holds only for itself, such as whether the interdiff is open or
which pane a narrow window shows, stays in that screen, in
[`screens/`](index.md#screens).

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import type { Place } from "./model/place";
import { LocalHistoryScreen } from "./screens/LocalHistoryScreen";
import { PullRequestsScreen } from "./screens/PullRequestsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LocalHistoryContext, useLocalHistory } from "./state/localHistory";
import { usePlace } from "./state/place";
import { ReviewContext, useReview } from "./state/review";
import { SettingsContext, useSettings } from "./state/settings";

export function App() {
  const [place, go] = usePlace();
  const settings = useSettings();
  const review = useReview();
  const localHistory = useLocalHistory();

  return (
    <SettingsContext value={settings}>
      <ReviewContext value={review}>
        <LocalHistoryContext value={localHistory}>
          {screenAt(place, go)}
        </LocalHistoryContext>
      </ReviewContext>
    </SettingsContext>
  );
}

function screenAt(place: Place, go: (place: Place) => void) {
  switch (place.tab) {
    case "local":
      return <LocalHistoryScreen onGo={go} />;
    case "pulls":
      return <PullRequestsScreen place={place.pull} onGo={go} />;
    case "settings":
      return <SettingsScreen onGo={go} />;
  }
}
```

Every screen draws its window as a column: a tab strip that does not
scroll, and under it the screen's own content. The body's default margin goes, because a
full-height app measured against the viewport inside an eight-pixel margin is
sixteen pixels taller than the window and scrolls when it should not.

The height is `100dvh` and not `100vh`. A mobile browser's address bar and
toolbar sit inside what `vh` calls the viewport, so on a phone `100vh` is the
window plus the chrome covering it, and the last rows of the diff spend their
life underneath it. `dvh` is the window as it currently stands, which is the
only number a full-height layout can mean.

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
    height: 100dvh;
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

Each screen draws the strip itself and goes to the place a tab opens on,
[`tabPlace`](address.md#the-place). Pressing the tab of the screen already
open does nothing. Going to that screen's bare place instead would throw
away the pull request and the line a reader is on, for a click that asked
for nothing new.

```tsx
//| id: frontend-view-mode-tabs
//| file: src/frontend/views/ModeTabs.tsx
export type Mode = "local" | "pulls" | "settings";

const CAPTIONS: Record<Mode, string> = {
  local: "Local history",
  pulls: "Pull requests",
  settings: "Settings",
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

On a phone the tabs' side padding halves, which keeps all three on a
390-pixel screen at every text size. A narrower screen scrolls the strip
sideways, and no tab shrinks or wraps its caption.

```css
/*| id: design-mode-tabs
@layer components {
  .tabs {
    display: flex;
    flex: none;
    overflow-x: auto;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .tab {
    flex: none;
    padding: var(--space-3) var(--space-6);
    font: inherit;
    color: var(--text);
    white-space: nowrap;
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

@layer components-narrow {
  @media (max-width: 480px) {
    .tab {
      padding-inline: var(--space-4);
    }
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
