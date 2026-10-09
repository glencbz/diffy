// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-row>>[init]
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { shownPathOf } from "../../../model/changedFiles";
import { collapseReason } from "../../../model/collapse";
import type { FileCompare } from "../../../model/compared";
import type { FileDiff } from "../../../model/diff";
import type { DiffLinks } from "../../../model/place";
import {
  type Anchor,
  drawnAt,
  type LineAnchor,
  type RowComment,
} from "../../../model/review";
import type { DiffMode, Display } from "../../../model/settings";
import type { SourceLookup } from "../../../model/source";
import { splitRows } from "../../../model/split";
import { CommentComposer, CommentThreads } from "../../Comments";
import { CompareWith } from "./CompareWith";
import { DiffModeSwitch } from "./DiffModeSwitch";
import {
  anchorKey,
  type CodeLine,
  type DrawnLine,
  drawnLines,
  patchBody,
  type Side,
  sidesOf,
  structuralBody,
} from "./drawnLines";
import { type FileLinks, fileLinks, follow } from "./links";
import { EmptyCell, type LineAction, PatchLine } from "./PatchLine";

/** What a layer over the diff, such as [components](components.md), draws on one
 *  file, whatever the file is drawn for. */
export interface LineDecor {
  /** After the path in the header. */
  header: ReactNode;
  /** The classes a line of the file takes, if any. */
  lineClass: (line: CodeLine) => string | null;
  /** What sits in a line's sign column in place of its sign, if anything. */
  marker: (line: CodeLine) => ReactNode;
  /** What draws under one line, after its comments. */
  under: (anchor: LineAnchor) => ReactNode;
  /** What draws above the lines, given the keys of those drawn, so what
   *  belongs on a line not drawn still shows. */
  above: (drawn: ReadonlySet<string>) => ReactNode;
  /** A column beside the lines, or null for none. */
  aside: ReactNode;
  /** What draws just before a line, given the last added or removed line
   *  before it in the same column and hunk, so a run of changes can carry a
   *  heading. Optional: a layer without headings leaves it out. */
  over?: (line: CodeLine, previous: CodeLine | null) => ReactNode;
  /** What a token's text draws as, where a layer marks words in the code. */
  token?: (text: string, line: CodeLine) => ReactNode;
}

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
  onReplyToComment: (id: string, body: string) => void;
  onEditReply: (commentId: string, replyId: string, body: string) => void;
  onDropReply: (commentId: string, replyId: string) => void;
  viewed: boolean;
  onToggleViewed: () => void;
  /** Null for a file with no after side, or a diff with nothing to compare. */
  compare: FileCompare | null;
  /** The after-side files the reader compared this one with. */
  comparedWith: string[];
}

export function FileRow({
  file,
  anchor,
  sources,
  display,
  variant,
  links: diffLinks,
  reveal,
  decor,
}: {
  file: FileDiff;
  anchor: string;
  sources?: SourceLookup;
  display: Display;
  variant: FileRowVariant;
  links?: DiffLinks;
  reveal?: number;
  decor?: LineDecor;
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
  const drawnKeys = new Set(
    content.kind === "text"
      ? content.lines.flatMap((line) =>
          "anchor" in line ? [anchorKey(line.anchor)] : [],
        )
      : [],
  );
  const parts = partsOf(
    variant,
    path,
    file.patch,
    links,
    content.kind !== "folded",
    drawnKeys,
    setOpened,
  );

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
        decor={
          decor === undefined || !("anchor" in line)
            ? undefined
            : {
                className: decor.lineClass(line),
                // A line in both columns takes its marker in its own side's.
                marker:
                  side === undefined || line.anchor.side === side
                    ? decor.marker(line)
                    : null,
                token:
                  decor.token === undefined
                    ? undefined
                    : (text: string) => decor.token?.(text, line),
              }
        }
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
      <Fragment key={key}>
        {parts.underLine(line.anchor)}
        {decor?.under(line.anchor)}
      </Fragment>
    ) : null;

  return (
    <section id={anchor} ref={section} className="diff-file" data-path={path}>
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
          <span
            className={`diff-file__status diff-file__status--${file.status}`}
          >
            {file.status}
          </span>
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
        {decor?.header}
        {parts.note}
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
      {content.kind === "text" && decor?.above(drawnKeys)}
      {content.kind === "text" && decor != null && decor.aside != null ? (
        <div className="diff-file__beside">
          {lines()}
          {decor.aside}
        </div>
      ) : (
        lines()
      )}
      {parts.belowBody}
    </section>
  );

  // The last changed line drawn in each column, so a heading knows the run
  // it starts. A hunk header or a gap ends a run.
  function overs() {
    const last: Record<"one" | Side, CodeLine | null> = {
      one: null,
      before: null,
      after: null,
    };
    return (line: DrawnLine | null, column: "one" | Side): ReactNode => {
      if (line === null) return null;
      if (!("anchor" in line)) {
        last[column] = null;
        return null;
      }
      const drawnOver = decor?.over?.(line, last[column]) ?? null;
      if (line.kind !== "context") last[column] = line;
      return drawnOver;
    };
  }

  function lines(): ReactNode {
    const over = overs();
    return content.kind === "folded" ? null : content.kind === "binary" ? (
      <p className="diff-file__binary">Binary file, no textual diff.</p>
    ) : split ? (
      <pre className="diff-file__patch diff-file__patch--split">
        {splitRows(content.lines).flatMap((row, index) => {
          if (row.kind === "across") {
            over(row.line, "before");
            over(row.line, "after");
            return [drawn(row.line, 2 * index)];
          }
          const before = over(row.before, "before");
          const after =
            row.after === row.before ? null : over(row.after, "after");
          return [
            before === null && after === null ? null : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering lines
              <Fragment key={`over-${index}`}>
                <div className="diff-line diff-line--before diff-line--over">
                  {before}
                </div>
                <div className="diff-line diff-line--after diff-line--over">
                  {after}
                </div>
              </Fragment>
            ),
            cell(row.before, 2 * index, "before"),
            cell(row.after, 2 * index + 1, "after"),
            under(row.before, `before-${index}`),
            row.after === row.before
              ? null
              : under(row.after, `after-${index}`),
          ];
        })}
      </pre>
    ) : (
      <pre className="diff-file__patch">
        {content.lines.flatMap((line, index) => [
          // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering lines
          <Fragment key={`over-${index}`}>{over(line, "one")}</Fragment>,
          drawn(line, index),
          under(line, `under-${index}`),
        ])}
      </pre>
    );
  }
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
  /** What the header says after the path. */
  note: ReactNode;
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
  patch: string,
  links: FileLinks | undefined,
  open: boolean,
  /** The keys of the lines drawn. */
  drawn: ReadonlySet<string>,
  setOpened: (opened: boolean) => void,
): VariantParts {
  switch (variant.kind) {
    case "plain-diff":
      return {
        lineAction:
          links === undefined ? { kind: "none" } : { kind: "link", links },
        note: null,
        controls: null,
        aboveBody: null,
        underLine: () => null,
        belowBody: null,
      };
    case "review": {
      const placed = (comment: RowComment) => {
        const at = drawnAt(comment, patch);
        return at !== null && drawn.has(anchorKey(at));
      };
      const composer =
        variant.composer?.kind === "line" ? variant.composer : null;
      return {
        lineAction: {
          kind: "comment",
          onOpenComposer: (at) =>
            variant.onOpenComposer({ kind: "line", path, ...at }),
        },
        note: variant.comparedWith.length > 0 && (
          <span className="diff-file__reason">
            compared with {variant.comparedWith.join(", ")}
          </span>
        ),
        controls: (
          <>
            {variant.compare !== null &&
              (open || variant.compare.against !== null) && (
                <CompareWith compare={variant.compare} />
              )}
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
            patch={patch}
          />
        ),
        underLine: (anchor) => {
          const key = anchorKey(anchor);
          const composing = composer !== null && anchorKey(composer) === key;
          const comments = variant.comments.filter((comment) => {
            const at = drawnAt(comment, patch);
            return at !== null && anchorKey(at) === key;
          });
          if (!composing && comments.length === 0) return null;
          return (
            <div className="diff-file__line-comments">
              <FileComments
                review={variant}
                composer={composing}
                comments={comments}
                patch={patch}
              />
            </div>
          );
        },
        belowBody: open && (
          <FileComments
            review={variant}
            composer={composer !== null && !drawn.has(anchorKey(composer))}
            comments={variant.comments.filter(
              (comment) => comment.kind === "line" && !placed(comment),
            )}
            patch={patch}
          />
        ),
      };
    }
  }
}

/** The composer, when it is open here, and threads. */
function FileComments({
  review,
  composer,
  comments,
  patch,
}: {
  review: ReviewFileRow;
  composer: boolean;
  comments: RowComment[];
  patch: string;
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
        patch={patch}
        onResolveComment={review.onResolveComment}
        onDropComment={review.onDropComment}
        onReplyToComment={review.onReplyToComment}
        onEditReply={review.onEditReply}
        onDropReply={review.onDropReply}
      />
    </>
  );
}
// ~/~ end
