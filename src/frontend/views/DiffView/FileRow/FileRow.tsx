// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-row>>[init]
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
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
import { type FileLinks, fileLinks, follow } from "./links";
import { EmptyCell, type LineAction, PatchLine } from "./PatchLine";

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
  onEditComment: (id: string, body: string) => void;
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
  const content: FileContent = !open
    ? { kind: "folded" }
    : file.binary
      ? { kind: "binary" }
      : { kind: "text", lines: drawnLines(body, sides, shown) };
  const parts = partsOf(variant, path, links, content, setOpened);

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
        action={parts.lineAction}
        selected={links?.selected?.line ?? null}
      />
    );
  const cell = (line: DrawnLine | null, key: number, side: Side) =>
    line === null ? (
      <EmptyCell key={key} side={side} />
    ) : (
      drawn(line, key, side)
    );
  const under = (line: DrawnLine | null, key: string) =>
    line !== null && "anchor" in line ? (
      <Fragment key={key}>{parts.underLine(line.anchor)}</Fragment>
    ) : null;

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
        {content.kind === "text" && (
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
      {content.kind === "folded" ? null : content.kind === "binary" ? (
        <p className="diff-file__binary">Binary file, no textual diff.</p>
      ) : split ? (
        <pre className="diff-file__patch diff-file__patch--split">
          {splitRows(content.lines).flatMap((row, index) =>
            row.kind === "across"
              ? [drawn(row.line, 2 * index)]
              : [
                  cell(row.before, 2 * index, "before"),
                  cell(row.after, 2 * index + 1, "after"),
                  under(row.before, `before-${index}`),
                  row.after === row.before
                    ? null
                    : under(row.after, `after-${index}`),
                ],
          )}
        </pre>
      ) : (
        <pre className="diff-file__patch">
          {content.lines.flatMap((line, index) => [
            drawn(line, index),
            under(line, `under-${index}`),
          ])}
        </pre>
      )}
      {parts.belowBody}
    </section>
  );
}

/** What a file draws under its header. Only text has lines to draw or a
 *  view to draw them in. */
type FileContent =
  | { kind: "folded" }
  | { kind: "binary" }
  | { kind: "text"; lines: DrawnLine[] };

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
  lineAction: LineAction;
  /** Controls at the end of the header. */
  controls: ReactNode;
  aboveBody: ReactNode;
  /** What draws under one line of the patch. */
  underLine: (anchor: LineAnchor) => ReactNode;
  belowBody: ReactNode;
}

function partsOf(
  variant: FileRowVariant,
  path: string,
  links: FileLinks | undefined,
  content: FileContent,
  setOpened: (opened: boolean) => void,
): VariantParts {
  const open = content.kind !== "folded";
  switch (variant.kind) {
    case "plain-diff":
      return {
        lineAction:
          links === undefined ? { kind: "none" } : { kind: "link", links },
        controls: null,
        aboveBody: null,
        underLine: () => null,
        belowBody: null,
      };
    case "review": {
      const drawn = new Set(
        content.kind === "text"
          ? content.lines.flatMap((line) =>
              "anchor" in line ? [lineKey(line.anchor)] : [],
            )
          : [],
      );
      const placed = (comment: RowComment) => {
        const at = drawnAt(comment);
        return at !== null && drawn.has(lineKey(at));
      };
      const composer =
        variant.composer?.kind === "line" ? variant.composer : null;
      return {
        lineAction: {
          kind: "comment",
          onOpenComposer: (at) =>
            variant.onOpenComposer({ kind: "line", path, ...at }),
        },
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
        aboveBody: open && (
          <FileComments
            review={variant}
            composer={variant.composer?.kind === "file"}
            comments={variant.comments.filter(
              (comment) => comment.kind === "file",
            )}
          />
        ),
        underLine: (anchor) => {
          const key = lineKey(anchor);
          const composing = composer !== null && lineKey(composer) === key;
          const comments = variant.comments.filter((comment) => {
            const at = drawnAt(comment);
            return at !== null && lineKey(at) === key;
          });
          if (!composing && comments.length === 0) return null;
          return (
            <div className="diff-file__line-comments">
              <FileComments
                review={variant}
                composer={composing}
                comments={comments}
              />
            </div>
          );
        },
        belowBody: open && (
          <FileComments
            review={variant}
            composer={composer !== null && !drawn.has(lineKey(composer))}
            comments={variant.comments.filter(
              (comment) => comment.kind === "line" && !placed(comment),
            )}
          />
        ),
      };
    }
  }
}

/** Where a line comment draws, or null where its number may count lines of
 *  a tree this diff does not show, as a stale comment's does. */
function drawnAt(comment: RowComment): LineAnchor | null {
  return comment.kind === "line" && !comment.stale
    ? { side: comment.side, line: comment.line }
    : null;
}

function lineKey({ side, line }: LineAnchor): string {
  return `${side}:${line}`;
}

/** The composer, when it is open here, and threads. */
function FileComments({
  review,
  composer,
  comments,
}: {
  review: ReviewFileRow;
  composer: boolean;
  comments: RowComment[];
}) {
  return (
    <>
      {composer && review.composer !== null && (
        <CommentComposer
          anchor={review.composer}
          onCancel={review.onCancelComposer}
          onSubmit={review.onSubmitComposer}
        />
      )}
      <CommentThreads
        comments={comments}
        onEditComment={review.onEditComment}
        onResolveComment={review.onResolveComment}
        onDropComment={review.onDropComment}
      />
    </>
  );
}
// ~/~ end
