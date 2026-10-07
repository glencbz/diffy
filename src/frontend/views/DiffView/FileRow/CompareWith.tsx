// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-compare-with>>[init]
import { useState } from "react";
import type { AsyncState } from "../../../model/asyncState";
import type { FileCompare } from "../../../model/compared";

/** Rows of the before tree drawn at once. */
const SHOWN = 50;

function matches(path: string, filter: string): boolean {
  return path.toLowerCase().includes(filter.toLowerCase());
}

export function CompareWith({ compare }: { compare: FileCompare }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  if (compare.against !== null) {
    return (
      <button
        type="button"
        className="diff-file__uncompare"
        aria-label={`stop comparing with ${compare.against}`}
        title="stop comparing"
        onClick={() => compare.onCompare(null)}
      >
        ×
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    setFilter("");
  };
  const pick = (path: string) => {
    compare.onCompare(path);
    close();
  };
  const inRow = compare.inRow.filter((path) => matches(path, filter));
  const listed = new Set(compare.inRow);
  const tree =
    compare.beforePaths?.status === "ready"
      ? compare.beforePaths.data.filter(
          (path) => !listed.has(path) && matches(path, filter),
        )
      : [];
  const first = inRow[0] ?? tree[0];

  return (
    <span className="compare-with">
      <button
        type="button"
        className="diff-file__compare"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          compare.onWantBeforePaths();
        }}
      >
        compare with...
      </button>
      {open && (
        <>
          <button
            type="button"
            className="compare-with__scrim"
            aria-label="Close the file list"
            onClick={close}
          />
          <div
            className="compare-with__sheet"
            role="dialog"
            aria-label="Compare with a before-side file"
          >
            <div className="compare-with__head">
              <input
                type="text"
                className="compare-with__filter"
                placeholder="Filter before-side files..."
                aria-label="Filter before-side files"
                // biome-ignore lint/a11y/noAutofocus: the list opens to be typed into
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                  if (event.key === "Enter" && first !== undefined) {
                    pick(first);
                  }
                }}
              />
            </div>
            <div className="compare-with__body">
              {inRow.length > 0 && (
                <PathGroup
                  label="in this comparison"
                  paths={inRow}
                  onPick={pick}
                />
              )}
              <TreeGroup
                state={compare.beforePaths}
                paths={tree}
                onPick={pick}
              />
            </div>
          </div>
        </>
      )}
    </span>
  );
}

function TreeGroup({
  state,
  paths,
  onPick,
}: {
  state: AsyncState<string[]> | null;
  paths: string[];
  onPick: (path: string) => void;
}) {
  const label = "anywhere in the before tree";
  if (state === null || state.status === "loading") {
    return <p className="compare-with__note">Reading the before tree...</p>;
  }
  if (state.status === "error") {
    return <p className="compare-with__note">{state.message}</p>;
  }
  if (paths.length === 0) return null;
  return (
    <>
      <PathGroup label={label} paths={paths.slice(0, SHOWN)} onPick={onPick} />
      {paths.length > SHOWN && (
        <p className="compare-with__note">
          {paths.length - SHOWN} more; narrow the filter to see them
        </p>
      )}
    </>
  );
}

function PathGroup({
  label,
  paths,
  onPick,
}: {
  label: string;
  paths: string[];
  onPick: (path: string) => void;
}) {
  return (
    <>
      <div className="compare-with__label">{label}</div>
      <ul className="compare-with__list">
        {paths.map((path) => {
          const cut = path.lastIndexOf("/") + 1;
          return (
            <li key={path}>
              <button
                type="button"
                className="compare-with__option"
                title={path}
                onClick={() => onPick(path)}
              >
                <span className="compare-with__name">{path.slice(cut)}</span>
                <span className="compare-with__dir">{path.slice(0, cut)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
// ~/~ end
