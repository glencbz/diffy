// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-file-navigator>>[init]
import { type RefObject, useEffect, useRef, useState } from "react";
import { type ChangedFile, fileTree } from "../model/changedFiles";
import { FileTree } from "./FileTree";

/** What names a row's commit once there is more than one row to tell
 *  apart. */
export interface FileNavigatorHeading {
  /** The commit's short change id. */
  id: string;
  subject: string;
  /** The id of the row's whole section, for a jump to its top. */
  anchor: string;
}

/** One row's files, under its heading. */
export interface FileNavigatorGroup {
  heading: FileNavigatorHeading | null;
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
  const [currentGroup, setCurrentGroup] = useState(0);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const files = groups.flatMap((group) => group.files);
  const index = Math.max(
    0,
    files.findIndex((file) => file.anchor === current),
  );
  const currentFile = files[index] ?? null;
  const heading = groups[currentGroup]?.heading ?? null;

  useCurrentFile(root, groups, setCurrent, setCurrentGroup);
  useCloseOnEscape(open, () => setOpen(false));

  const jumpTo = ({ anchor }: { anchor: string }) => {
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
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
          {heading !== null && (
            <span className="file-navigator__commit">{heading.id}</span>
          )}
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
                <div
                  key={group.heading?.anchor ?? at}
                  className="file-navigator__group"
                >
                  {group.heading !== null && (
                    <GroupHeading heading={group.heading} onPick={jumpTo} />
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

function GroupHeading({
  heading,
  onPick,
}: {
  heading: FileNavigatorHeading;
  onPick: (heading: FileNavigatorHeading) => void;
}) {
  return (
    <button
      type="button"
      className="file-navigator__group-label"
      onClick={() => onPick(heading)}
    >
      <span className="file-navigator__commit">{heading.id}</span>
      <span className="file-navigator__subject">{heading.subject}</span>
    </button>
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-file-navigator>>[1]

const READING_LINE = 60;

function useCurrentFile(
  root: RefObject<HTMLDivElement | null>,
  groups: FileNavigatorGroup[],
  setCurrent: (anchor: string | null) => void,
  setCurrentGroup: (group: number) => void,
) {
  useEffect(() => {
    const container = root.current?.closest(".pane--diff");
    if (!(container instanceof HTMLElement)) return;

    let frame: number | null = null;
    const recompute = () => {
      frame = null;
      const containerTop = container.getBoundingClientRect().top;
      const crossed = (anchor: string): boolean => {
        const element = document.getElementById(anchor);
        return (
          element !== null &&
          element.getBoundingClientRect().top - containerTop <= READING_LINE
        );
      };

      let group = 0;
      let file: string | null = null;
      groups.forEach((each, position) => {
        if (each.heading !== null && crossed(each.heading.anchor)) {
          group = position;
          file = each.files[0]?.anchor ?? null;
        }
        for (const { anchor } of each.files) {
          if (crossed(anchor)) {
            group = position;
            file = anchor;
          }
        }
      });
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2
      ) {
        group = groups.length - 1;
        file = groups[group]?.files.at(-1)?.anchor ?? file;
      }
      setCurrentGroup(group);
      setCurrent(file ?? groups[group]?.files[0]?.anchor ?? null);
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
  }, [root, groups, setCurrent, setCurrentGroup]);
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
