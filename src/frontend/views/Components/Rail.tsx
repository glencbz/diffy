// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-rail>>[init]
import type {
  Component,
  ComponentRole,
  Fate,
  FileShare,
} from "../../model/components";
import { CommentIcon, MessageIcon } from "./icons";

/** One component as the rail lists it. */
export interface RailEntry {
  component: Component;
  /** How it fares in the comparison on screen; null when it says nothing. */
  fate: Fate | null;
  /** Whether the comparison on screen draws any of it. */
  drawn: boolean;
  places: number;
  threads: number;
}

/** One file of the current row, and its changed lines by component. */
export interface RailFile {
  path: string;
  shares: FileShare[];
}

const ROLES: [ComponentRole, string][] = [
  ["implements", "implements"],
  ["refactors", "refactors"],
  ["wires", "wires through"],
  ["tests", "tests"],
];

// The paired graph's marks: + added, − dropped, ~ changed.
const MARKS: Record<Fate, string> = {
  new: "+",
  removed: "−",
  changed: "~",
  unchanged: "=",
};

export function Rail({
  comparing,
  entries,
  files,
  reading,
  onMessage,
  onGo,
  onGoShare,
}: {
  comparing: string;
  entries: RailEntry[];
  files: RailFile[];
  /** The component and file under the reading line. */
  reading: { id: string; path: string } | null;
  onMessage: (() => void) | null;
  onGo: (entry: RailEntry) => void;
  onGoShare: (path: string, share: FileShare) => void;
}) {
  return (
    <>
      {onMessage !== null && (
        <button
          type="button"
          className="components-rail__message"
          title="the commit message, which names the components it introduces"
          onClick={onMessage}
        >
          <MessageIcon /> commit message
        </button>
      )}
      <h3 className="components-rail__head">
        Components <small>{comparing}</small>
      </h3>
      <ul className="components-toc">
        {ROLES.flatMap(([role, label]) => {
          const own = entries.filter((entry) => entry.component.role === role);
          if (own.length === 0) return [];
          return [
            <li key={role} className="components-toc__group">
              {label}
            </li>,
            ...own.map((entry) => {
              const { component } = entry;
              const here = reading?.id === component.id;
              return (
                <li
                  key={component.id}
                  className={`components-kind--${component.kind}${here ? " components-toc--here" : ""}${entry.drawn ? "" : " components-toc--off"}`}
                >
                  <button
                    type="button"
                    className="components-toc__entry"
                    onClick={() => onGo(entry)}
                  >
                    <span
                      className={`components-toc__fate components-fate--${entry.fate ?? "none"}`}
                      title={entry.fate ?? ""}
                    >
                      {entry.fate === null ? "" : MARKS[entry.fate]}
                    </span>
                    <span className="components-heading__kind">
                      {component.kind}
                    </span>
                    <span className="components-toc__name">
                      {component.name}
                    </span>
                    {entry.threads > 0 && (
                      <span
                        className="components-toc__count"
                        title={`${entry.threads} thread${entry.threads === 1 ? "" : "s"}`}
                      >
                        <CommentIcon /> {entry.threads}
                      </span>
                    )}
                    {entry.places > 1 && (
                      <span
                        className="components-toc__count"
                        title={`${entry.places} places`}
                      >
                        ×{entry.places}
                      </span>
                    )}
                  </button>
                </li>
              );
            }),
          ];
        })}
      </ul>
      <h3 className="components-rail__head">
        Files <small>each bar: its changed lines, by component</small>
      </h3>
      {files.map((file) => {
        const total = file.shares.reduce((sum, share) => sum + share.lines, 0);
        return (
          <div
            key={file.path}
            className={`components-file${reading?.path === file.path ? " components-file--here" : ""}`}
          >
            <span className="components-file__path">
              <span className="components-file__total">{total}</span>
              {file.path.replace(/^src\/(frontend\/|backend\/)?/, "")}
            </span>
            <span className="components-file__strip">
              {file.shares.map((share) => {
                const component = share.first?.component;
                const lit =
                  component !== undefined &&
                  reading?.id === component.id &&
                  reading.path === file.path;
                return (
                  <button
                    type="button"
                    key={share.id ?? ""}
                    style={{ flexGrow: share.lines }}
                    className={
                      component === undefined
                        ? "components-file__unowned"
                        : `components-kind--${component.kind}${lit ? " components-file--lit" : ""}`
                    }
                    title={`${component === undefined ? "no component" : `${component.kind} ${component.name}`}: ${share.lines} of ${total} changed lines (${Math.round((100 * share.lines) / total)}%)`}
                    onClick={() => onGoShare(file.path, share)}
                  />
                );
              })}
            </span>
          </div>
        );
      })}
    </>
  );
}
// ~/~ end
