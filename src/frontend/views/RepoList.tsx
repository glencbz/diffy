// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-view-repo-list>>[init]
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
// ~/~ end
