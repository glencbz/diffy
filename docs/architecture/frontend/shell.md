# Shell

The page, the root component, and the switch between the two screens.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack):
Bun bundles what its `<script>` and `<link>` tags pull in.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <!-- Without it a phone lays out 980px wide and shrinks to fit, so the
         phone breakpoints never match. -->
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

`App` reads the open screen from the [address](address.md) through
`usePlace`; the `switch` over `place.tab` is the routing table. What belongs to
more than one screen, or must survive one unmounting, is held here in a
context: [settings](settings.md#sharing-the-settings), the
[review document](review.md#holding-it-while-it-changes), and
[local history](local-history.md#polling-the-operation-log).

```tsx
//| id: frontend-app
//| file: src/frontend/App.tsx
import type { Place } from "./model/place";
import { LocalHistoryScreen } from "./screens/LocalHistoryScreen";
import { LocalReviewsScreen } from "./screens/LocalReviewsScreen";
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
    case "reviews":
      return <LocalReviewsScreen place={place.review} onGo={go} />;
    case "local":
      return <LocalHistoryScreen onGo={go} />;
    case "pulls":
      return <PullRequestsScreen place={place.pull} onGo={go} />;
    case "settings":
      return <SettingsScreen onGo={go} />;
  }
}
```

```css
/*| id: design-app
@layer components {
  /* An 8px margin makes a full-height app scroll. */
  body {
    margin: 0;
  }

  /* dvh: on a phone 100vh includes the browser chrome over the page. Every
     flex ancestor of a scrolling pane also needs min-height: 0, since the
     default auto refuses to shrink below content. */
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

"Local reviews" comes first, since they hold what is waiting for the reader,
and the operation screen's tab is "Operations", for what it compares.
Pressing the open screen's tab does nothing, rather than going to its bare
[`tabPlace`](address.md#the-place) and losing the reader's place.

```tsx
//| id: frontend-view-mode-tabs
//| file: src/frontend/views/ModeTabs.tsx
export type Mode = "reviews" | "local" | "pulls" | "settings";

const CAPTIONS: Record<Mode, string> = {
  reviews: "Local reviews",
  local: "Operations",
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
  /* Keeps every tab on a 390px screen; narrower scrolls the strip. */
  @media (max-width: 480px) {
    .tab {
      padding-inline: var(--space-4);
    }
  }
}
```

## Message

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
