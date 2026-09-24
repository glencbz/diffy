// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-file-navigator>>[init]
import { type RefObject, useEffect, useRef, useState } from "react";
import { type ChangedFile, fileTree } from "./changedFiles";
import { FileTree } from "./FileTree";

/** One row's files, headed by its own label once there is more than one
 *  row to tell apart. */
export interface FileNavigatorGroup {
  label: string | null;
  files: ChangedFile[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function matches(file: ChangedFile, query: string): boolean {
  return query === "" || file.path.toLowerCase().includes(query.toLowerCase());
}

export function FileNavigator({ groups }: { groups: FileNavigatorGroup[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const files = groups.flatMap((group) => group.files);
  const index = Math.max(
    0,
    files.findIndex((file) => file.anchor === current),
  );
  const currentFile = files[index] ?? null;

  useCurrentFile(root, files, setCurrent);
  useCloseOnEscape(open, () => setOpen(false));

  const jumpTo = (file: ChangedFile) => {
    document.getElementById(file.anchor)?.scrollIntoView({ block: "start" });
    setOpen(false);
  };
  const step = (delta: number) => {
    const next = files[clamp(index + delta, 0, files.length - 1)];
    if (next !== undefined) jumpTo(next);
  };

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      files: group.files.filter((file) => matches(file, filter)),
    }))
    .filter((group) => group.files.length > 0);

  return (
    <div className="file-navigator" ref={root}>
      <div className="file-navigator__bar">
        <button
          type="button"
          className="file-navigator__step"
          aria-label="Previous file"
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="file-navigator__open"
          aria-label="Show changed files"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="file-navigator__pos">
            {files.length === 0 ? "0 / 0" : `${index + 1} / ${files.length}`}
          </span>
          <span className="file-navigator__path">
            {`\u200e${currentFile?.path ?? ""}`}
          </span>
        </button>
        <button
          type="button"
          className="file-navigator__step"
          aria-label="Next file"
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>
      {open && (
        <>
          <button
            type="button"
            className="file-navigator__scrim"
            aria-label="Close changed files"
            onClick={() => setOpen(false)}
          />
          <div
            className="file-navigator__sheet"
            role="dialog"
            aria-label="Changed files"
          >
            <div className="file-navigator__sheet-handle" />
            <div className="file-navigator__sheet-head">
              <input
                type="text"
                className="file-navigator__filter"
                placeholder="Filter files…"
                aria-label="Filter files"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="file-navigator__sheet-body">
              {visibleGroups.map((group, at) => (
                <div key={group.label ?? at} className="file-navigator__group">
                  {group.label !== null && (
                    <div className="file-navigator__group-label">
                      {group.label}
                    </div>
                  )}
                  <FileTree
                    nodes={fileTree(group.files)}
                    current={current}
                    onPick={jumpTo}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-file-navigator>>[1]

const READING_LINE = 60;

function useCurrentFile(
  root: RefObject<HTMLDivElement | null>,
  files: ChangedFile[],
  setCurrent: (anchor: string | null) => void,
) {
  useEffect(() => {
    const container = root.current?.closest(".pane--diff");
    if (!(container instanceof HTMLElement)) return;

    let frame: number | null = null;
    const recompute = () => {
      frame = null;
      const elements = files
        .map((file) => document.getElementById(file.anchor))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;

      const containerTop = container.getBoundingClientRect().top;
      let at = 0;
      elements.forEach((element, position) => {
        if (
          element.getBoundingClientRect().top - containerTop <=
          READING_LINE
        ) {
          at = position;
        }
      });
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2
      ) {
        at = elements.length - 1;
      }
      setCurrent(files[at]?.anchor ?? null);
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(recompute);
    };

    recompute();
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [root, files, setCurrent]);
}

function useCloseOnEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
// ~/~ end
