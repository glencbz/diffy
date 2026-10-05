// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-row>>[init]
import { type ReactNode, useEffect, useRef, useState } from "react";
import { shownPathOf } from "../../../model/changedFiles";
import { collapseReason } from "../../../model/collapse";
import type { FileDiff } from "../../../model/diff";
import type { DiffLinks } from "../../../model/place";
import type { Anchor, LineAnchor, RowComment } from "../../../model/review";
import type { DiffMode, Display } from "../../../model/settings";
import type { SourceLookup } from "../../../model/source";
import { splitRows } from "../../../model/split";
import { CommentComposer, CommentThreads } from "../../Comments";
import { DiffModeSwitch } from "./DiffModeSwitch";
import {
  type DrawnLine,
  drawnLines,
  patchBody,
  type Side,
  sidesOf,
  structuralBody,
} from "./drawnLines";
import { fileLinks, follow } from "./links";
import { EmptyCell, PatchLine } from "./PatchLine";

/** What a file is drawn for: to be read, or to be reviewed. */
export type FileRowVariant = PlainDiffFileRow | ReviewFileRow;

/** A diff to read. Nothing in it records anything. */
export interface PlainDiffFileRow {
  kind: "plain-diff";
}

/** A diff under review: `DiffReview` narrowed to one file, with the
 *  composer this view owns. */
export interface ReviewFileRow {
  kind: "review";
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
  sources,
  display,
  variant,
  links: diffLinks,
  reveal,
}: {
  file: FileDiff;
  anchor: string;
  sources?: SourceLookup;
  display: Display;
  variant: FileRowVariant;
  links?: DiffLinks;
  reveal?: number;
}) {
  const sides = sidesOf(file, sources);
  const links =
    diffLinks === undefined ? undefined : fileLinks(diffLinks, file);
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
  const open = opened ?? (isSelected || startsOpen(variant, reason));
  const parts = partsOf(variant, path, open, setOpened);
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
        onOpenComposer={parts.onOpenComposer}
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
        {parts.controls}
      </header>
      {parts.aboveBody}
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
      {parts.belowBody}
    </section>
  );
}

/** Whether a file is open until the reader folds it, when the address does
 *  not name it. */
function startsOpen(variant: FileRowVariant, reason: string | null): boolean {
  switch (variant.kind) {
    case "plain-diff":
      return reason === null;
    case "review":
      return (
        !variant.viewed && (reason === null || variant.comments.length > 0)
      );
  }
}

/** What a variant adds to the file a plain diff draws. */
interface VariantParts {
  /** Opens the composer on a line. A plain diff's lines are static. */
  onOpenComposer?: (at: LineAnchor) => void;
  /** Controls at the end of the header. */
  controls: ReactNode;
  aboveBody: ReactNode;
  belowBody: ReactNode;
}

function partsOf(
  variant: FileRowVariant,
  path: string,
  open: boolean,
  setOpened: (opened: boolean) => void,
): VariantParts {
  switch (variant.kind) {
    case "plain-diff":
      return { controls: null, aboveBody: null, belowBody: null };
    case "review":
      return {
        onOpenComposer: (at) =>
          variant.onOpenComposer({ kind: "line", path, ...at }),
        controls: (
          <>
            {open && (
              <button
                type="button"
                className="diff-file__comment"
                aria-label="comment on file"
                onClick={() => variant.onOpenComposer({ kind: "file", path })}
              >
                comment
              </button>
            )}
            <label className="diff-file__viewed">
              <input
                type="checkbox"
                checked={variant.viewed}
                onChange={() => {
                  variant.onToggleViewed();
                  setOpened(variant.viewed);
                }}
              />
              Viewed
            </label>
          </>
        ),
        aboveBody: open && <FileComments review={variant} kind="file" />,
        belowBody: open && <FileComments review={variant} kind="line" />,
      };
  }
}

/** A file's composer and threads for one kind of anchor: the whole file's
 *  under its header, its lines' under its patch. */
function FileComments({
  review,
  kind,
}: {
  review: ReviewFileRow;
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
