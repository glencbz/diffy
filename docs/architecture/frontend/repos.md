# Repository picker

The reader picks the repository diffy serves from a switcher at the left of the
tab bar, or from a screen of its own when diffy started with none. The server
side, which decides where a run starts and keeps the recent list, is
[choosing the repository](../backend/repos.md).

## The shapes

Paths arrive absolute and are drawn with `~` for the home directory, the way
the reader types them. A path the reader types is told from a filter by its
first character, so `~/src` opens a folder while `src` narrows the list.

```ts
//| id: frontend-model-repo
//| file: src/frontend/model/repo.ts
export interface ServedRepo {
  home: string;
  /** The workspace root being served, or null before the reader picks one. */
  current: string | null;
}

export interface RepoSummary {
  root: string;
  workingCopy: string;
  reviews: number;
  openedAt: string | null;
}

export interface FoundRepo {
  root: string;
  kind: "jj" | "git";
}

export interface RecentEntry {
  root: string;
  openedAt: string;
}

export type RepoProbe =
  | { kind: "jj" | "git"; root: string }
  | { kind: "none" }
  | { kind: "checking" };

export function tildePath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** A path's last folder and the folders above it, as the picker draws them. */
export function pathParts(path: string): { name: string; parent: string } {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return { name: path, parent: "" };
  if (cut === 0) return { name: path.slice(1), parent: "/" };
  return { name: path.slice(cut + 1), parent: path.slice(0, cut) };
}

export function isPathQuery(query: string): boolean {
  return /^[~/.]/.test(query.trim());
}

export function matchesQuery(
  root: string,
  home: string,
  query: string,
): boolean {
  const asked = query.trim().toLowerCase();
  return asked === "" || tildePath(root, home).toLowerCase().includes(asked);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function since(at: string, now: number): string {
  const elapsed = now - Date.parse(at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return `${Math.floor(elapsed / (30 * DAY))}mo ago`;
}
```

```ts
//| id: frontend-model-repo-test
//| file: src/frontend/model/repo.test.ts
import { describe, expect, test } from "bun:test";
import { isPathQuery, matchesQuery, pathParts, since, tildePath } from "./repo";

describe("tildePath", () => {
  test("writes the home directory as ~", () => {
    expect(tildePath("/home/me", "/home/me")).toBe("~");
    expect(tildePath("/home/me/src/a", "/home/me")).toBe("~/src/a");
    expect(tildePath("/home/meadow", "/home/me")).toBe("/home/meadow");
  });
});

describe("pathParts", () => {
  test("splits off the last folder", () => {
    expect(pathParts("~/src/a")).toEqual({ name: "a", parent: "~/src" });
    expect(pathParts("~")).toEqual({ name: "~", parent: "" });
    expect(pathParts("/a")).toEqual({ name: "a", parent: "/" });
  });
});

describe("the query", () => {
  test("is a path when it starts like one", () => {
    expect(isPathQuery("~/src")).toBe(true);
    expect(isPathQuery(" /srv")).toBe(true);
    expect(isPathQuery("src")).toBe(false);
  });

  test("matches the path as drawn, ignoring case", () => {
    expect(matchesQuery("/home/me/Work/api", "/home/me", "work/a")).toBe(true);
    expect(matchesQuery("/home/me/src/a", "/home/me", "work")).toBe(false);
    expect(matchesQuery("/home/me/src/a", "/home/me", "")).toBe(true);
  });
});

describe("since", () => {
  test("rounds down to the largest unit", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(since("2026-10-14T11:59:30Z", now)).toBe("just now");
    expect(since("2026-10-14T11:15:00Z", now)).toBe("45m ago");
    expect(since("2026-10-14T09:00:00Z", now)).toBe("3h ago");
    expect(since("2026-10-11T12:00:00Z", now)).toBe("3d ago");
    expect(since("2026-08-01T12:00:00Z", now)).toBe("2mo ago");
  });
});
```

## Holding the served repository

`useServedRepo` sits above every screen, which waits for it: a screen drawn
before it answers could fetch from a repository about to be replaced. Opening
a repository reloads the page at `/`, since every slice of state, the place
in the address included, belongs to the old one. Resetting each slice in
place would need every `state/` hook to know about the switch.

Another browser can switch the repository under this one. The hook asks again
whenever the tab comes back into view and reloads if the answer moved, so a
phone left on one repository catches up when the reader looks at it. Pushing
the switch over the review socket would also reach a tab in view, but the
reader is looking at one screen at a time.

A link an agent hands the reader names its repository in `?repo=` when the
reader is shown another one. The first answer opens that repository, then
loads the link without the parameter, so a reload or a shared address does
not switch the repository again.

```tsx
//| id: frontend-state-repo
//| file: src/frontend/state/repo.ts
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchFoundRepos,
  fetchRecentRepos,
  fetchServedRepo,
  forgetRecentRepo,
  openRepo,
  probeRepoPath,
  restoreRecentRepo,
} from "../api";
import type { AsyncState } from "../model/asyncState";
import {
  type FoundRepo,
  isPathQuery,
  type RecentEntry,
  type RepoProbe,
  type RepoSummary,
  type ServedRepo,
} from "../model/repo";

export interface RepoHandle {
  served: AsyncState<ServedRepo>;
  /** Serve the repository at `path` and start over in it, or answer why not. */
  open: (path: string) => Promise<string | null>;
}

function failed(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serve the repository a link names in `?repo=`, then load the link
 *  without it. True when the page is reloading. */
async function openLinked(current: string | null): Promise<boolean> {
  const url = new URL(location.href);
  const linked = url.searchParams.get("repo");
  if (linked === null) return false;
  url.searchParams.delete("repo");
  // A repository that will not open leaves the reader where they were.
  if (linked !== current) await openRepo(linked).catch(() => undefined);
  location.replace(url);
  return true;
}

export function useServedRepo(): RepoHandle {
  const [served, setServed] = useState<AsyncState<ServedRepo>>({
    status: "loading",
  });

  useEffect(() => {
    let shown: string | null | undefined;
    let cancelled = false;
    const load = () =>
      fetchServedRepo().then(
        async (next) => {
          if (cancelled) return;
          if (shown === undefined && (await openLinked(next.current))) return;
          if (shown !== undefined && next.current !== shown) {
            location.assign("/");
            return;
          }
          shown = next.current;
          setServed({ status: "ready", data: next });
        },
        (error) => {
          // A failed recheck leaves the screen as it is; only the first
          // answer decides whether there is anything to draw.
          if (!cancelled && shown === undefined) {
            setServed({ status: "error", message: failed(error) });
          }
        },
      );
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const open = useCallback(async (path: string) => {
    try {
      await openRepo(path);
      location.assign("/");
      return null;
    } catch (error) {
      return failed(error);
    }
  }, []);

  return useMemo(() => ({ served, open }), [served, open]);
}

export const RepoContext = createContext<RepoHandle | null>(null);

export function useRepoContext(): RepoHandle {
  const repo = useContext(RepoContext);
  if (repo === null) throw new Error("no RepoContext above this screen");
  return repo;
}
```

## What the picker lists

The picker's lists load when it opens, not with the page. Forgetting a recent
repository takes it off the list at once and offers to undo, which puts the
server's copy back with its old time; nothing asks to confirm.

A typed path is checked a moment after the reader stops typing, so the
picker can say whether it holds a jj repository before they press Enter.

```tsx
//| id: frontend-state-repo

export interface RepoChoices {
  recent: AsyncState<RepoSummary[]>;
  found: AsyncState<FoundRepo[]>;
  /** The entry forgotten last, while it can still be put back. */
  forgotten: RecentEntry | null;
  forget: (root: string) => void;
  undo: () => void;
}

export function useRepoChoices(): RepoChoices {
  const [recent, setRecent] = useState<AsyncState<RepoSummary[]>>({
    status: "loading",
  });
  const [found, setFound] = useState<AsyncState<FoundRepo[]>>({
    status: "loading",
  });
  const [forgotten, setForgotten] = useState<RecentEntry | null>(null);

  const loadRecent = useCallback(
    () =>
      fetchRecentRepos().then(
        (data) => setRecent({ status: "ready", data }),
        (error) => setRecent({ status: "error", message: failed(error) }),
      ),
    [],
  );

  useEffect(() => {
    void loadRecent();
    fetchFoundRepos().then(
      (data) => setFound({ status: "ready", data }),
      (error) => setFound({ status: "error", message: failed(error) }),
    );
  }, [loadRecent]);

  const forget = useCallback((root: string) => {
    setRecent((now) =>
      now.status === "ready"
        ? { status: "ready", data: now.data.filter((r) => r.root !== root) }
        : now,
    );
    forgetRecentRepo(root).then(setForgotten, () => setForgotten(null));
  }, []);

  const undo = useCallback(() => {
    if (forgotten === null) return;
    setForgotten(null);
    void restoreRecentRepo(forgotten).then(loadRecent);
  }, [forgotten, loadRecent]);

  return { recent, found, forgotten, forget, undo };
}

const PROBE_AFTER_MS = 200;

export function useRepoProbe(query: string): RepoProbe | null {
  const path = isPathQuery(query) ? query.trim() : null;
  const [probe, setProbe] = useState<RepoProbe | null>(null);

  useEffect(() => {
    if (path === null) {
      setProbe(null);
      return;
    }
    setProbe({ kind: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      probeRepoPath(path).then(
        (answer) => {
          if (!cancelled) setProbe(answer);
        },
        () => {
          if (!cancelled) setProbe({ kind: "none" });
        },
      );
    }, PROBE_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  return probe;
}
```

## Repo list

`RepoList` is the picker itself, drawn in the switcher's popover and on the
open-a-repository screen. Recent repositories come newest first, then the ones
found under the home directory. A Git repository without jj is listed but
cannot be opened, with the command that would make it openable. The arrow
keys move through every row that can be opened, the typed path first.

```tsx
//| id: frontend-view-repo-list
//| file: src/frontend/views/RepoList.tsx
import { useEffect, useRef, useState } from "react";
import type { AsyncState } from "../model/asyncState";
import {
  type FoundRepo,
  matchesQuery,
  pathParts,
  type RecentEntry,
  type RepoProbe,
  type RepoSummary,
  since,
  tildePath,
} from "../model/repo";

type Row =
  | { kind: "path"; path: string; probe: RepoProbe }
  | { kind: "recent"; repo: RepoSummary }
  | { kind: "found"; repo: FoundRepo };

function opensTo(row: Row): string | null {
  switch (row.kind) {
    case "path":
      return row.probe.kind === "jj" ? row.path : null;
    case "recent":
      return row.repo.root;
    case "found":
      return row.repo.kind === "jj" ? row.repo.root : null;
  }
}

const GIT_ONLY = "Git only: run jj git init --colocate in it to open it";

function probeNote(probe: RepoProbe): string {
  switch (probe.kind) {
    case "checking":
      return "checking...";
    case "jj":
      return "jj repository";
    case "git":
      return GIT_ONLY;
    case "none":
      return "no jj repository here";
  }
}

export function RepoList({
  home,
  current,
  recent,
  found,
  query,
  probe,
  failure,
  forgotten,
  now,
  onQuery,
  onOpen,
  onForget,
  onUndo,
  onClose,
}: {
  home: string;
  current: string | null;
  recent: AsyncState<RepoSummary[]>;
  found: AsyncState<FoundRepo[]>;
  query: string;
  probe: RepoProbe | null;
  /** Why the last open failed. */
  failure: string | null;
  forgotten: RecentEntry | null;
  now: number;
  onQuery: (query: string) => void;
  onOpen: (path: string) => void;
  onForget: (root: string) => void;
  onUndo: () => void;
  onClose?: () => void;
}) {
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const recentRows: Row[] =
    recent.status === "ready"
      ? recent.data
          .filter((repo) => matchesQuery(repo.root, home, query))
          .map((repo) => ({ kind: "recent", repo }))
      : [];
  const foundRows: Row[] =
    found.status === "ready"
      ? found.data
          .filter((repo) => matchesQuery(repo.root, home, query))
          .map((repo) => ({ kind: "found", repo }))
      : [];
  const pathRow: Row | null =
    probe === null ? null : { kind: "path", path: query.trim(), probe };
  const rows = [...(pathRow ? [pathRow] : []), ...recentRows, ...foundRows];
  const openable = rows.filter((row) => opensTo(row) !== null);
  const activeRow = openable[Math.min(active, openable.length - 1)];

  const move = (by: number) =>
    setActive(Math.max(0, Math.min(active + by, openable.length - 1)));

  const rowFor = (row: Row) => {
    const path = opensTo(row);
    const key = row.kind === "path" ? "path" : row.repo.root;
    const className = [
      "repo-row",
      row === activeRow && "repo-row--active",
      path === null && "repo-row--closed",
    ]
      .filter(Boolean)
      .join(" ");
    const select = () => {
      if (path !== null) onOpen(path);
    };

    if (row.kind === "path") {
      return (
        <li key={key} className={className}>
          <button
            type="button"
            className="repo-row__main"
            disabled={path === null}
            onClick={select}
          >
            <span className="repo-row__mark">↵</span>
            <span className="repo-row__text">
              <span className="repo-row__name">Open {row.path}</span>
              <span className="repo-row__detail">{probeNote(row.probe)}</span>
            </span>
          </button>
        </li>
      );
    }

    const shown = pathParts(tildePath(row.repo.root, home));
    const isCurrent = row.repo.root === current;
    return (
      <li
        key={key}
        className={className}
        onMouseEnter={() => {
          const at = openable.indexOf(row);
          if (at >= 0) setActive(at);
        }}
      >
        <button
          type="button"
          className="repo-row__main"
          disabled={path === null}
          aria-current={isCurrent}
          onClick={select}
        >
          <span className="repo-row__mark">{isCurrent ? "✓" : ""}</span>
          <span className="repo-row__text">
            <span className="repo-row__name">
              {shown.name}
              <span className="repo-row__parent">{shown.parent}</span>
            </span>
            <span className="repo-row__detail">
              {row.kind === "found"
                ? row.repo.kind === "git"
                  ? GIT_ONLY
                  : "not opened yet"
                : `@ ${row.repo.workingCopy || "(no description set)"}`}
            </span>
          </span>
          {row.kind === "recent" && (
            <span className="repo-row__meta">
              {row.repo.reviews > 0 && (
                <span className="repo-row__reviews">
                  {row.repo.reviews}{" "}
                  {row.repo.reviews === 1 ? "review" : "reviews"}
                </span>
              )}
              {row.repo.openedAt !== null && (
                <span>{since(row.repo.openedAt, now)}</span>
              )}
            </span>
          )}
        </button>
        {row.kind === "recent" && !isCurrent && (
          <button
            type="button"
            className="repo-row__forget"
            title="Remove from recent"
            aria-label={`Remove ${shown.name} from recent`}
            onClick={() => onForget(row.repo.root)}
          >
            ×
          </button>
        )}
      </li>
    );
  };

  const loading = recent.status === "loading" || found.status === "loading";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys belong to the input inside; the wrapper only hears them bubble
    <div
      className="repo-list"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") move(1);
        else if (event.key === "ArrowUp") move(-1);
        else if (event.key === "Enter" && activeRow) {
          const path = opensTo(activeRow);
          if (path !== null) onOpen(path);
        } else if (event.key === "Escape") onClose?.();
        else return;
        event.preventDefault();
      }}
    >
      <input
        ref={input}
        className="repo-list__input"
        placeholder="Filter, or type a path like ~/src/app"
        aria-label="Filter repositories or type a path"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          setActive(0);
        }}
      />
      {failure !== null && <p className="repo-list__failure">{failure}</p>}
      <ul className="repo-list__rows">
        {pathRow && rowFor(pathRow)}
        {recentRows.length > 0 && (
          <li className="repo-list__heading">Recent</li>
        )}
        {recentRows.map(rowFor)}
        {foundRows.length > 0 && (
          <li className="repo-list__heading">Found under ~</li>
        )}
        {foundRows.map(rowFor)}
        {rows.length === 0 && (
          <li className="repo-list__empty">
            {loading
              ? "Looking for repositories..."
              : query.trim() === ""
                ? "No repositories yet. Type a path to one."
                : `No repository matches “${query.trim()}”.`}
          </li>
        )}
      </ul>
      {forgotten !== null && (
        <div className="repo-list__undo">
          Removed {pathParts(tildePath(forgotten.root, home)).name} from recent.
          <button type="button" onClick={onUndo}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
```

## Repo switcher

The switcher is the first thing in the tab bar and names the served
repository by its folder, with the folders above it beside. Its popover is
fixed to the viewport under the button, because the tab bar scrolls sideways
on a phone and would clip anything positioned inside it. `Ctrl+O` opens it
from anywhere.

```tsx
//| id: frontend-view-repo-switcher
//| file: src/frontend/views/RepoSwitcher.tsx
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { pathParts, tildePath } from "../model/repo";

export function RepoSwitcher({
  home,
  current,
  open,
  onOpenChange,
  children,
}: {
  home: string;
  current: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picker, drawn in the popover while it is open. */
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [below, setBelow] = useState<CSSProperties>({});
  const shown = pathParts(tildePath(current, home));

  useLayoutEffect(() => {
    const box = button.current?.getBoundingClientRect();
    if (box) setBelow({ top: box.bottom + 4, left: Math.max(box.left, 8) });
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    // Escape is heard on the document, since focus can leave the picker,
    // as when the Undo button it pressed goes away.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "o") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [onOpenChange]);

  return (
    <div className="repo-switcher" ref={root}>
      <button
        ref={button}
        type="button"
        className="repo-switcher__button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${tildePath(current, home)} (Ctrl+O to switch)`}
        onClick={() => onOpenChange(!open)}
      >
        <span className="repo-switcher__name">{shown.name}</span>
        <span className="repo-switcher__parent">{shown.parent}</span>
        <span className="repo-switcher__caret">▾</span>
      </button>
      {open && (
        <div className="repo-switcher__popover" role="dialog" style={below}>
          {children}
        </div>
      )}
    </div>
  );
}
```

## Wiring them up

`RepoPicker` wires the picker's lists and the typed path to `RepoList`, and
mounts only while a picker is on screen. `RepoMenu` wires the served
repository to the switcher; every screen hands it to
[`ModeTabs`](shell.md#mode-tabs).

```tsx
//| id: frontend-controller-repo-picker
//| file: src/frontend/controllers/RepoPicker.tsx
import { useState } from "react";
import { useRepoChoices, useRepoContext, useRepoProbe } from "../state/repo";
import { RepoList } from "../views/RepoList";

export function RepoPicker({
  home,
  current,
  onClose,
}: {
  home: string;
  current: string | null;
  onClose?: () => void;
}) {
  const repo = useRepoContext();
  const choices = useRepoChoices();
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const probe = useRepoProbe(query);

  return (
    <RepoList
      home={home}
      current={current}
      recent={choices.recent}
      found={choices.found}
      query={query}
      probe={probe}
      failure={failure}
      forgotten={choices.forgotten}
      now={Date.now()}
      onQuery={setQuery}
      onOpen={async (path) => {
        if (path === current) return onClose?.();
        setFailure(await repo.open(path));
      }}
      onForget={choices.forget}
      onUndo={choices.undo}
      onClose={onClose}
    />
  );
}
```

```tsx
//| id: frontend-controller-repo-menu
//| file: src/frontend/controllers/RepoMenu.tsx
import { useState } from "react";
import { useRepoContext } from "../state/repo";
import { RepoSwitcher } from "../views/RepoSwitcher";
import { RepoPicker } from "./RepoPicker";

export function RepoMenu() {
  const repo = useRepoContext();
  const [open, setOpen] = useState(false);
  if (repo.served.status !== "ready") return null;
  const { home, current } = repo.served.data;
  if (current === null) return null;

  return (
    <RepoSwitcher
      home={home}
      current={current}
      open={open}
      onOpenChange={setOpen}
    >
      <RepoPicker
        home={home}
        current={current}
        onClose={() => setOpen(false)}
      />
    </RepoSwitcher>
  );
}
```

## Open a repository

With nothing served, `App` draws this screen in place of the tabs.

```tsx
//| id: frontend-screen-open-repo
//| file: src/frontend/screens/OpenRepoScreen.tsx
import { RepoPicker } from "../controllers/RepoPicker";

export function OpenRepoScreen({ home }: { home: string }) {
  return (
    <div className="open-repo">
      <div className="open-repo__card">
        <h1>Open a repository</h1>
        <p>
          diffy is not serving a repository. Pick one, or type a path. Next time
          diffy opens the one used last.
        </p>
        <RepoPicker home={home} current={null} />
      </div>
    </div>
  );
}
```

## Design

```css
/*| id: design-repos
@layer components {
  .repo-switcher {
    display: flex;
    flex: none;
    border-right: 1px solid var(--border);
  }

  .repo-switcher__button {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: var(--text);
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .repo-switcher__button:hover,
  .repo-switcher__button[aria-expanded="true"] {
    background: var(--surface-sunken);
  }

  .repo-switcher__name {
    font-weight: bold;
  }

  .repo-switcher__parent,
  .repo-switcher__caret {
    color: var(--text-faint);
  }

  .repo-switcher__popover {
    position: fixed;
    z-index: 50;
    width: min(560px, calc(100vw - 2 * var(--space-4)));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
  }

  .repo-list {
    display: flex;
    flex-direction: column;
    max-height: min(70dvh, 560px);
  }

  .repo-list__input {
    padding: var(--space-5);
    font: inherit;
    color: var(--text);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    outline: none;
  }

  .repo-list__failure {
    margin: 0;
    padding: var(--space-3) var(--space-5);
    color: var(--danger);
  }

  .repo-list__rows {
    margin: 0;
    padding: var(--space-2) 0;
    overflow-y: auto;
    list-style: none;
  }

  .repo-list__heading {
    padding: var(--space-4) var(--space-5) var(--space-2);
    font-size: 0.8em;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .repo-list__empty {
    padding: var(--space-5);
    color: var(--text-muted);
  }

  .repo-list__undo {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3) var(--space-5);
    background: var(--surface-raised);
    border-top: 1px solid var(--border-subtle);
  }

  .repo-list__undo button {
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: none;
    border: none;
  }

  .repo-row {
    display: flex;
  }

  .repo-row--active {
    background: var(--surface-selected);
  }

  .repo-row__main {
    display: flex;
    flex: 1;
    gap: var(--space-4);
    align-items: center;
    min-width: 0;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
  }

  .repo-row--closed .repo-row__main {
    color: var(--text-muted);
    cursor: default;
  }

  .repo-row__mark {
    flex: none;
    width: 1.2em;
    color: var(--accent);
  }

  .repo-row__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .repo-row__name {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;
    font-weight: bold;
  }

  .repo-row__parent,
  .repo-row__detail {
    overflow: hidden;
    font-size: 0.9em;
    font-weight: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repo-row__parent {
    color: var(--text-faint);
  }

  .repo-row__detail {
    color: var(--text-muted);
  }

  .repo-row--closed .repo-row__detail {
    color: var(--text-faint);
  }

  .repo-row__meta {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-end;
    font-size: 0.85em;
    color: var(--text-faint);
  }

  .repo-row__reviews {
    padding: 0 var(--space-3);
    color: var(--accent);
    background: var(--review-unseen-surface);
    border-radius: var(--radius);
  }

  /* Shown on hover and for the active row, so the list reads as names. */
  .repo-row__forget {
    flex: none;
    width: 2em;
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    visibility: hidden;
    background: none;
    border: none;
  }

  .repo-row:hover .repo-row__forget,
  .repo-row--active .repo-row__forget {
    visibility: visible;
  }

  .repo-row__forget:hover {
    color: var(--danger);
  }

  .open-repo {
    display: flex;
    justify-content: center;
    min-height: 100dvh;
    padding: 12dvh var(--space-6) var(--space-6);
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--text-size);
    color: var(--text);
    background: var(--surface-raised);
  }

  .open-repo__card {
    align-self: flex-start;
    width: min(600px, 100%);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
  }

  .open-repo__card h1 {
    margin: 0;
    padding: var(--space-6) var(--space-6) 0;
    font-size: 1.3em;
  }

  .open-repo__card p {
    margin: 0;
    padding: var(--space-4) var(--space-6) var(--space-5);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .open-repo__card .repo-list__input {
    border-top: 1px solid var(--border);
  }
}

@layer components-narrow {
  /* No hover on a phone, and the name alone fits the tab bar. */
  @media (max-width: 480px) {
    .repo-switcher__parent {
      display: none;
    }

    .repo-row__forget {
      visibility: visible;
    }
  }
}
```
