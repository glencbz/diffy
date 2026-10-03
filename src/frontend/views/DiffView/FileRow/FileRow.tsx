// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-row>>[init]
import { useEffect, useRef, useState } from "react";
import { shownPathOf } from "../../../model/changedFiles";
import { collapseReason } from "../../../model/collapse";
import type { FileDiff } from "../../../model/diff";
import type { Anchor, RowComment } from "../../../model/review";
import type { DiffMode, Display } from "../../../model/settings";
import { splitRows } from "../../../model/split";
import { CommentComposer, CommentThreads } from "../../Comments";
import { DiffModeSwitch } from "./DiffModeSwitch";
import {
  type DrawnLine,
  drawnLines,
  type FileSides,
  patchBody,
  type Side,
  structuralBody,
} from "./drawnLines";
import { type FileLinks, follow } from "./links";
import { EmptyCell, PatchLine } from "./PatchLine";

/** `DiffReview` narrowed to one file, with the composer this view owns. */
export interface FileReview {
  comments: RowComment[];
  composer: Anchor | null;
  onOpenComposer: (anchor: Anchor) => void;
  onCancelComposer: () => void;
  onSubmitComposer: (anchor: Anchor, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
  viewed: boolean;
  onToggleViewed: () => void;
}

export function FileRow({
  file,
  anchor,
  sides,
  display,
  review,
  links,
  reveal,
}: {
  file: FileDiff;
  anchor: string;
  sides: FileSides;
  display: Display;
  review?: FileReview;
  links?: FileLinks;
  reveal?: number;
}) {
  const section = useRef<HTMLElement>(null);
  const isSelected = links?.selected != null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal is the trigger; a click that selects a line must not scroll
  useEffect(() => {
    if (!isSelected) return;
    section.current
      ?.querySelector(".diff-file__header--selected, .diff-line--selected")
      ?.scrollIntoView({ block: "center" });
  }, [reveal]);
  const { diffMode: defaultMode, wordMarkLimit } = display;
  const split = display.diffLayout === "split";
  const [chosen, setChosen] = useState<DiffMode | null>(null);
  const [shownIn, setShownIn] = useState<Record<DiffMode, ReadonlySet<number>>>(
    { structural: new Set(), line: new Set() },
  );

  const structural =
    file.structural.kind === "structural" ? file.structural : null;
  const mode = structural === null ? "line" : (chosen ?? defaultMode);
  const body =
    structural !== null && mode === "structural"
      ? structuralBody(structural, wordMarkLimit)
      : patchBody(file.patch);
  const shown = shownIn[mode];
  const reason = collapseReason(file);
  const path = shownPathOf(file);
  const [opened, setOpened] = useState<boolean | null>(null);
  const viewed = review?.viewed ?? false;
  const open =
    opened ??
    (isSelected ||
      (!viewed && (reason === null || (review?.comments.length ?? 0) > 0)));
  const lines = open && !file.binary ? drawnLines(body, sides, shown) : [];

  const drawn = (line: DrawnLine, key: number, side?: Side) =>
    line.kind === "gap" ? (
      <button
        key={key}
        type="button"
        className="diff-line diff-line--gap"
        onClick={() =>
          setShownIn((all) => ({
            ...all,
            [mode]: new Set(all[mode]).add(line.gap),
          }))
        }
      >
        <span className="diff-line__gutter">⋯</span>
        <span>
          show {line.count} unchanged {line.count === 1 ? "line" : "lines"}
        </span>
      </button>
    ) : (
      <PatchLine
        key={key}
        line={line}
        side={side}
        onOpenComposer={
          review === undefined
            ? undefined
            : (at) => review.onOpenComposer({ kind: "line", path, ...at })
        }
        links={links}
      />
    );
  const cell = (line: DrawnLine | null, key: number, side: Side) =>
    line === null ? (
      <EmptyCell key={key} side={side} />
    ) : (
      drawn(line, key, side)
    );

  return (
    <section id={anchor} ref={section} className="diff-file">
      <header
        className={
          links?.selected != null && links.selected.line === null
            ? "diff-file__header diff-file__header--selected"
            : "diff-file__header"
        }
      >
        <button
          type="button"
          className="diff-file__toggle"
          aria-expanded={open}
          onClick={() => setOpened(!open)}
        >
          <span className="diff-file__chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="diff-file__status">{file.status}</span>
          {links === undefined && (
            <span className="diff-file__path">{shownPathOf(file)}</span>
          )}
        </button>
        {links !== undefined && (
          <a
            href={links.href(null)}
            onClick={(event) => follow(event, () => links.onFollow(null))}
            className="diff-file__path"
          >
            {shownPathOf(file)}
          </a>
        )}
        {reason !== null && <span className="diff-file__reason">{reason}</span>}
        {open && !file.binary && (
          <DiffModeSwitch
            mode={mode}
            unavailable={
              file.structural.kind === "unavailable"
                ? file.structural.reason
                : null
            }
            onChoose={setChosen}
          />
        )}
        {open && review !== undefined && (
          <button
            type="button"
            className="diff-file__comment"
            aria-label="comment on file"
            onClick={() => review.onOpenComposer({ kind: "file", path })}
          >
            comment
          </button>
        )}
        {review !== undefined && (
          <label className="diff-file__viewed">
            <input
              type="checkbox"
              checked={viewed}
              onChange={() => {
                review.onToggleViewed();
                setOpened(viewed);
              }}
            />
            Viewed
          </label>
        )}
      </header>
      {open && review !== undefined && (
        <FileComments review={review} kind="file" />
      )}
      {!open ? null : file.binary ? (
        <p className="diff-file__binary">Binary file, no textual diff.</p>
      ) : split ? (
        <pre className="diff-file__patch diff-file__patch--split">
          {splitRows(lines).flatMap((row, index) =>
            row.kind === "across"
              ? [drawn(row.line, 2 * index)]
              : [
                  cell(row.before, 2 * index, "before"),
                  cell(row.after, 2 * index + 1, "after"),
                ],
          )}
        </pre>
      ) : (
        <pre className="diff-file__patch">
          {lines.map((line, index) => drawn(line, index))}
        </pre>
      )}
      {open && review !== undefined && (
        <FileComments review={review} kind="line" />
      )}
    </section>
  );
}

/** A file's composer and threads for one kind of anchor: the whole file's
 *  under its header, its lines' under its patch. */
function FileComments({
  review,
  kind,
}: {
  review: FileReview;
  kind: "file" | "line";
}) {
  return (
    <>
      {review.composer?.kind === kind && (
        <CommentComposer
          anchor={review.composer}
          onCancel={review.onCancelComposer}
          onSubmit={review.onSubmitComposer}
        />
      )}
      <CommentThreads
        comments={review.comments.filter((comment) => comment.kind === kind)}
        onResolveComment={review.onResolveComment}
        onDropComment={review.onDropComment}
      />
    </>
  );
}
// ~/~ end
