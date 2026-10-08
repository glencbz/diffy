# Diff

What the panel shows: one commit's diff, or a whole series lined up as an
interdiff.

## Choosing what to compare

`useComparison` asks for local comparisons only; a pull request asks row by
row on [its own screen](pull-requests.md#row-comparisons). Both sides empty
answers `null` with no request. While a new question loads, the diff already
on screen stays, so adding a commit never blanks the panel. Like
`useCommits`, the effect depends on the question's JSON.

```tsx
//| id: frontend-state-comparison
//| file: src/frontend/state/comparison.ts
import { useEffect, useState } from "react";
import { fetchInterdiff } from "../api";
import type { AsyncState } from "../model/asyncState";
import type { InterdiffRow } from "../model/diff";

/** What the diff panel is being asked for. */
export interface Comparison {
  from: string[];
  to: string[];
}

export function useComparison(
  question: Comparison,
): AsyncState<InterdiffRow[]> | null {
  const [state, setState] = useState<AsyncState<InterdiffRow[]> | null>(null);
  const key =
    question.from.length === 0 && question.to.length === 0
      ? ""
      : JSON.stringify(question);

  useEffect(() => {
    if (key === "") {
      setState(null);
      return;
    }

    let live = true;
    setState((now) => (now?.status === "ready" ? now : { status: "loading" }));
    const { from, to } = JSON.parse(key) as Comparison;
    fetchInterdiff(from, to)
      .then(({ rows }) => {
        if (live) setState({ status: "ready", data: rows });
      })
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}
```
## Diff pane controller

`DiffPane` loads [both sides of every file](syntax.md#loading-each-side)
(above its early returns, since hooks run on every render) and takes `review`
as a prop, since its [screen](local-history.md#the-screen) already holds it.
An empty before side means a plain diff, which `DiffPane` tells the rows:
a single row with no before commit cannot tell "plain diff" from "new in
this series". With more than one file it renders a
[`FileNavigator`](file-tree.md#stepping-through-files), scoped by the same
`rowKey` as the rows' anchors, with a heading per row once there are several.

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx

import { changedFilesOf } from "../model/changedFiles";
import { compareAsks, withCompared } from "../model/compared";
import { type ReviewedRow, reviewRows } from "../model/review";
import { useBeforePaths, useCompared } from "../state/compared";
import { type Comparison, useComparison } from "../state/comparison";
import type { ReviewHandle } from "../state/review";
import { useSettingsContext } from "../state/settings";
import { useSources } from "../state/source";
import {
  FileNavigator,
  type FileNavigatorGroup,
  type FileNavigatorHeading,
} from "../views/FileNavigator";
import { InterdiffRows, rowAnchor, rowKey } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  review,
}: {
  comparison: Comparison;
  review: ReviewHandle;
}) {
  const answer = useComparison(comparison);
  const { display } = useSettingsContext().settings;
  const reviewed =
    answer?.status === "ready" ? reviewRows(answer.data, review.document) : [];
  const compared = useCompared(reviewed.flatMap(compareAsks));
  const beforePaths = useBeforePaths();
  const rows = reviewed.map((row) => ({
    ...row,
    files: withCompared(row.files, compareAsks(row), compared),
  }));
  const sources = useSources(rows.flatMap((row) => row.files));

  if (answer === null) {
    return <Message>Select commits to see their diff.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }

  const groups: FileNavigatorGroup[] = rows.map((row) => ({
    heading: rows.length > 1 ? rowHeading(row) : null,
    files: changedFilesOf(row.files, rowKey(row), row.comments),
  }));
  const total = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <>
      {total >= 2 && <FileNavigator groups={groups} />}
      <InterdiffRows
        rows={rows}
        plain={comparison.from.length === 0}
        sources={sources}
        review={review.status === "ready" ? review.actions : null}
        beforePaths={beforePaths}
        display={display}
      />
    </>
  );
}

function rowHeading(row: ReviewedRow): FileNavigatorHeading {
  const commit = row.to ?? row.from;
  const subject = commit?.description.split("\n")[0] ?? "";
  return {
    id: (commit?.changeId ?? commit?.commitId ?? "").slice(0, 8),
    subject: subject === "" ? "(no description)" : subject,
    anchor: rowAnchor(row),
  };
}
```

## Diff view

`DiffView` draws a summary of the files when there is more than one, then
[each file](#a-file). All review behaviour hangs off one optional
`DiffReview`, so a read-only diff offers no comment or `Viewed` control that
would record nothing. `DiffLinks` turn the header path and after-side gutter
numbers into real `<a href>`s to [the address](address.md), naming a renamed
file by its new path, and mark the addressed file or line with a bar.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView/DiffView.tsx
import { useMemo, useState } from "react";
import {
  afterPathOf,
  changedFile,
  fileAnchor,
  fileVersionOf,
  shownPathOf,
} from "../../model/changedFiles";
import { beforePathsOf, type FileCompare } from "../../model/compared";
import type { FileDiff } from "../../model/diff";
import type { DiffLinks } from "../../model/place";
import {
  type Anchor,
  type CompareOffer,
  type DiffReview,
  isViewed,
} from "../../model/review";
import type { Display } from "../../model/settings";
import type { SourceLookup } from "../../model/source";
import { FileRow } from "./FileRow/FileRow";
import { FileSummary } from "./FileSummary";

export function DiffView({
  files,
  sources,
  review,
  scope,
  links,
  reveal,
  display,
}: {
  files: FileDiff[];
  sources?: SourceLookup;
  review?: DiffReview;
  /** Scopes this diff's file ids apart from any other diff on the page: a
   *  comparison row's key, or a pull request stack row's commit id. */
  scope: string;
  links?: DiffLinks;
  /** Changes each time the selected file or line should be brought into
   *  view. Mounting brings it into view too. */
  reveal?: number;
  /** How the reader asked for diffs to be drawn. */
  display: Display;
}) {
  const [composer, setComposer] = useState<Anchor | null>(null);

  const changedFiles = useMemo(
    () =>
      files.map((file) =>
        changedFile(
          file,
          fileAnchor(scope, afterPathOf(file)),
          review?.comments ?? [],
        ),
      ),
    [files, review?.comments, scope],
  );
  const inRow = beforePathsOf(files);

  return (
    <div className="diff-view">
      {changedFiles.length >= 2 && <FileSummary files={changedFiles} />}
      {files.map((file) => {
        const path = shownPathOf(file);
        const anchor = fileAnchor(scope, afterPathOf(file));
        return (
          <FileRow
            key={path}
            anchor={anchor}
            file={file}
            sources={sources}
            display={display}
            links={links}
            reveal={reveal}
            variant={
              review === undefined
                ? { kind: "plain-diff" }
                : {
                    kind: "review",
                    comments: review.comments.filter(
                      (comment) =>
                        comment.kind !== "comparison" && comment.path === path,
                    ),
                    composer:
                      composer !== null &&
                      composer.kind !== "comparison" &&
                      composer.path === path
                        ? composer
                        : null,
                    onOpenComposer: setComposer,
                    onCancelComposer: () => setComposer(null),
                    onSubmitComposer: (anchor, body) => {
                      review.onAddComment(anchor, body);
                      setComposer(null);
                    },
                    onEditComment: review.onEditComment,
                    onResolveComment: review.onResolveComment,
                    onDropComment: review.onDropComment,
                    onReplyToComment: review.onReplyToComment,
                    onEditReply: review.onEditReply,
                    onDropReply: review.onDropReply,
                    viewed: isViewed(review.viewed, fileVersionOf(file)),
                    onToggleViewed: () =>
                      review.onToggleViewed(fileVersionOf(file)),
                    compare: compareOf(review.compare, file, inRow),
                    comparedWith:
                      "path" in file
                        ? (review.compare?.compared ?? [])
                            .filter((pair) => pair.oldPath === file.path)
                            .map((pair) => pair.newPath)
                        : [],
                  }
            }
          />
        );
      })}
    </div>
  );
}

/** What one file can be compared with: anything on the before side but its
 *  own path, which its own diff already reads against. */
function compareOf(
  offer: CompareOffer | null,
  file: FileDiff,
  inRow: string[],
): FileCompare | null {
  if (offer === null || file.status === "deleted") return null;
  const newPath = afterPathOf(file);
  return {
    against: file.status === "compared" ? file.oldPath : null,
    inRow: inRow.filter((path) => path !== newPath),
    beforePaths: offer.beforePaths,
    onWantBeforePaths: offer.onWantBeforePaths,
    onCompare: (oldPath) => offer.onCompare(newPath, oldPath),
  };
}
```

### Files changed

With more than one file, a [summary tree](file-tree.md) sits above the
files, and each `<section>` carries an id scoped by row, so a path appearing
in two rows gets two anchors.

```tsx
//| id: frontend-view-diff-file-summary
//| file: src/frontend/views/DiffView/FileSummary.tsx
import { useMemo } from "react";
import { type ChangedFile, fileTree } from "../../model/changedFiles";
import { FileTree } from "../FileTree";

/** A table of contents for the files below, shown once there is more than
 *  one to summarise. Picking a row scrolls straight to that file's
 *  `<section>`, found by the same anchor id the section itself carries, so
 *  the summary needs no ref threaded down to reach it. */
export function FileSummary({ files }: { files: ChangedFile[] }) {
  const nodes = useMemo(() => fileTree(files), [files]);
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
  const changes = totals.added + totals.removed;

  return (
    <section className="file-summary" aria-label="Files changed">
      <header className="file-summary__head">
        <b className="file-summary__title">Files changed</b>
        <span className="file-summary__totals">
          <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
          {totals.added > 0 && (
            <span className="file-summary__added">+{totals.added}</span>
          )}
          {totals.removed > 0 && (
            <span className="file-summary__removed">−{totals.removed}</span>
          )}
          {changes > 0 && (
            <span className="file-summary__bar">
              <span
                className="file-summary__bar-added"
                style={{ width: `${(totals.added / changes) * 100}%` }}
              />
              <span
                className="file-summary__bar-removed"
                style={{ width: `${(totals.removed / changes) * 100}%` }}
              />
            </span>
          )}
        </span>
      </header>
      <div className="file-summary__tree">
        <FileTree nodes={nodes} current={null} onPick={jumpTo} />
      </div>
    </section>
  );
}

function jumpTo(file: ChangedFile): void {
  document.getElementById(file.anchor)?.scrollIntoView({ block: "start" });
}
```

### A file

The path in a header folds the file; where it is a link, the chevron and
status are the fold button. A [noisy file](#collapsed-files) or one already
marked `Viewed` starts folded, except that a comment (for noise) or the
address (for either) opens it. The marked target scrolls to the middle on
mount and on `reveal`, not when a click marked it.

A line's threads and composer draw inside the patch, right under the line
they name, as on GitHub and GitLab, so a comment reads beside its code. In
the side-by-side layout they span both columns under the row. A thread whose
line is not drawn, because a [hidden-lines](#hidden-lines) row covers it or
it was written against another commit, falls back to the list under the
file's `<pre>`, so no comment goes missing. A file comment draws under the
header.

A plain diff and a reviewed one differ only where `startsOpen` and
`partsOf` switch on the variant. Links to the address are not part of it,
because a pull request's stack links plain and reviewed diffs alike. One
component per variant around a shared frame would put the fold state in the
frame and the Viewed box that sets it outside, passing the setter between
them as props.

Around each hunk a row stands for the [hidden lines](#hidden-lines) once the
after side's length is known; clicking draws them as numbered, commentable
context. Gaps opened in one view are kept apart from the other's.

```tsx
//| id: frontend-view-diff-file-row
//| file: src/frontend/views/DiffView/FileRow/FileRow.tsx
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
  const parts = partsOf(variant, path, file.patch, links, content, setOpened);

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
  content: FileContent,
  setOpened: (opened: boolean) => void,
): VariantParts {
  const open = content.kind !== "folded";
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
      const drawn = new Set(
        content.kind === "text"
          ? content.lines.flatMap((line) =>
              "anchor" in line ? [lineKey(line.anchor)] : [],
            )
          : [],
      );
      const placed = (comment: RowComment) => {
        const at = drawnAt(comment, patch);
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
          const key = lineKey(anchor);
          const composing = composer !== null && lineKey(composer) === key;
          const comments = variant.comments.filter((comment) => {
            const at = drawnAt(comment, patch);
            return at !== null && lineKey(at) === key;
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
            composer={composer !== null && !drawn.has(lineKey(composer))}
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

function lineKey({ side, line }: LineAnchor): string {
  return `${side}:${line}`;
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
```

The header path and the gutter share one narrowing of `DiffLinks` to the
file.

```ts
//| id: frontend-view-diff-file-links
//| file: src/frontend/views/DiffView/FileRow/links.ts
import type { MouseEvent } from "react";
import { afterPathOf } from "../../../model/changedFiles";
import type { FileDiff } from "../../../model/diff";
import type { DiffLinks, FileSpot } from "../../../model/place";

/** `DiffLinks` narrowed to one file. */
export interface FileLinks {
  /** This file's place in the address, when the address names it. */
  selected: FileSpot | null;
  href: (line: number | null) => string;
  onFollow: (line: number | null) => void;
}

export function fileLinks(links: DiffLinks, file: FileDiff): FileLinks {
  const path = afterPathOf(file);
  return {
    selected: links.selected?.path === path ? links.selected : null,
    href: (line) => links.href({ path, line }),
    onFollow: (line) => links.onFollow({ path, line }),
  };
}

/** A plain click on a link is followed in place. One asking for a new tab
 *  or window is left to the browser, which is what the `href` is for. */
export function follow(event: MouseEvent, onFollow: () => void): void {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  onFollow();
}
```

#### Structural or patch

A file is drawn structurally ([difftastic](../backend/difft.md)) or as the
`git` patch, both delivered with every file, with a per-file switch whose
starting value is the [Settings default](settings.md#display). A file
difftastic has nothing for draws its patch, and the switch says why.

```tsx
//| id: frontend-view-diff-mode-switch
//| file: src/frontend/views/DiffView/FileRow/DiffModeSwitch.tsx
import type { DiffMode } from "../../../model/settings";

const DIFF_MODES: { value: DiffMode; caption: string }[] = [
  { value: "structural", caption: "structural" },
  { value: "line", caption: "lines" },
];

/** Which view one file is drawn in. The structural button is off, with the
 *  reason as its title, when difftastic has nothing for the file. */
export function DiffModeSwitch({
  mode,
  unavailable,
  onChoose,
}: {
  mode: DiffMode;
  unavailable: string | null;
  onChoose: (mode: DiffMode) => void;
}) {
  return (
    <fieldset className="diff-file__modes" aria-label="Diff view">
      {DIFF_MODES.map(({ value, caption }) => {
        const off = value === "structural" && unavailable !== null;
        return (
          <button
            key={value}
            type="button"
            className="diff-file__mode"
            aria-pressed={mode === value}
            disabled={off}
            title={off ? `No structural diff: ${unavailable}` : undefined}
            onClick={() => onChoose(value)}
          >
            {caption}
          </button>
        );
      })}
    </fieldset>
  );
}
```

#### Comparing with another file

A reviewed file with an after side offers `compare with...`, which
[reads it against](#comparing-two-files-by-hand) a before-side file of the
reader's choosing. The list offers the before-side paths the row's own files
name first, since a split's original or a missed rename's old name is almost
always one of them, then every other path of the before tree, read only once
the list opens. A compared file offers `×` in place of the button, which puts
its own diff back.

The list caps what it draws and asks for a narrower filter past that: a
whole tree is thousands of rows, and the reader finds a file by typing its
name, not by scrolling.

```tsx
//| id: frontend-view-diff-compare-with
//| file: src/frontend/views/DiffView/FileRow/CompareWith.tsx
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
```

#### Drawn lines

A file is drawn from hunks, never raw patch text:
[`readPatch`](#reading-a-patch) gives every line its kind and numbers, and the
`diff --git`/`index`/`---`/`+++` lines are not drawn, since the file header
already names the path. Each line's syntax colours come from its side's
`sources` entry (a removed line by its old number, others by the new), and
only when that line reads the same as the patch's; otherwise it is one plain
token. A patch is always right about its own text.

Both views are the same drawing over different hunks with the same
numbering, so a comment names the same line in either; only where changed
ranges come from differs. A hunk header with no jump left goes away.

```ts
//| id: frontend-view-diff-drawn-lines
//| file: src/frontend/views/DiffView/FileRow/drawnLines.ts
import type { FileDiff, StructuralDiff } from "../../../model/diff";
import {
  gapsOf,
  type HunkLine,
  type Patch,
  readPatch,
} from "../../../model/patch";
import type { LineAnchor } from "../../../model/review";
import type {
  SourceFile,
  SourceLookup,
  SyntaxToken,
} from "../../../model/source";
import {
  changedLines,
  markable,
  type PaintedToken,
  paintWords,
  type Range,
} from "../../../model/words";

/** The column a line is drawn in, when the diff has two. */
export type Side = "before" | "after";

export type CodeKind = "context" | "added" | "removed";

/** One line as drawn. Hunk headers and notes are text in one
 *  colour. A line of the file is its tokens and where it sits: a removed line
 *  on the before side, every other line on the after side. It also carries
 *  its before-side number where it has one, for the before column of a
 *  [side-by-side](#side-by-side) diff. A gap stands in for the lines
 *  `gapsOf` numbered `gap` until it is shown. */
export type DrawnLine =
  | { kind: "meta" | "hunk"; text: string }
  | { kind: "gap"; gap: number; count: number }
  | {
      kind: CodeKind;
      tokens: PaintedToken[];
      anchor: LineAnchor;
      beforeLine: number | null;
    };

/** Each side of one file, whole, where it has loaded. */
export interface FileSides {
  old: SourceFile | null;
  new: SourceFile | null;
}

export function sidesOf(file: FileDiff, sources?: SourceLookup): FileSides {
  const oldPath = "path" in file ? file.path : file.oldPath;
  const newPath = "path" in file ? file.path : file.newPath;
  return {
    old:
      sources === undefined || file.oldBlob === null
        ? null
        : sources(file.oldBlob, oldPath),
    new:
      sources === undefined || file.newBlob === null
        ? null
        : sources(file.newBlob, newPath),
  };
}

/** What a file's lines are drawn from: hunks, and each hunk's changed
 *  ranges by line index. */
interface Body {
  patch: Patch;
  changed: Map<number, Range[]>[];
}

/** A patch's hunks, without the `diff --git` lines above them, which say
 *  nothing the file's own header does not. */
export function patchBody(text: string): Body {
  const { hunks } = readPatch(text);
  return {
    patch: { header: [], hunks },
    changed: hunks.map((hunk) => changedLines(hunk.lines)),
  };
}

/** Difftastic's hunks, with a note in place of them when it found the
 *  change was only layout. Where it fell back to comparing text, its
 *  ranges are whole lines, so the words are paired as a patch's are. */
export function structuralBody(
  diff: Extract<StructuralDiff, { kind: "structural" }>,
  wordMarkLimit: number,
): Body {
  return {
    patch: {
      header:
        diff.hunks.length === 0
          ? ["No syntactic change. The line view shows the layout edits."]
          : [],
      hunks: diff.hunks,
    },
    changed: diff.hunks.map((hunk) =>
      diff.language.startsWith("Text")
        ? changedLines(hunk.lines)
        : new Map(
            hunk.lines.flatMap((line, index) =>
              line.kind === "context"
                ? []
                : [[index, markable(line.code, line.changes, wordMarkLimit)]],
            ),
          ),
    ),
  };
}

export function drawnLines(
  { patch, changed: changedIn }: Body,
  sides: FileSides,
  shown: ReadonlySet<number>,
): DrawnLine[] {
  const gaps =
    sides.new === null || patch.hunks.length === 0
      ? []
      : gapsOf(patch, sides.new.lines.length);

  const hidden = (index: number): DrawnLine[] => {
    const gap = gaps[index];
    if (gap === undefined || gap.count === 0) return [];
    if (!shown.has(index))
      return [{ kind: "gap", gap: index, count: gap.count }];
    return Array.from({ length: gap.count }, (_, offset) => ({
      kind: "context" as const,
      tokens: paintWords(sides.new?.lines[gap.start + offset - 1] ?? [], []),
      anchor: { side: "after" as const, line: gap.start + offset },
      beforeLine: gap.oldStart === null ? null : gap.oldStart + offset,
    }));
  };

  return [
    ...patch.header.map((text): DrawnLine => ({ kind: "meta", text })),
    ...patch.hunks.flatMap((hunk, index) => {
      const changed = changedIn[index] ?? new Map<number, Range[]>();
      return [
        ...hidden(index),
        ...(shown.has(index)
          ? []
          : [{ kind: "hunk" as const, text: hunk.header }]),
        ...hunk.lines.map((line, at) =>
          drawnHunkLine(line, sides, changed.get(at) ?? []),
        ),
      ];
    }),
    ...hidden(patch.hunks.length),
  ];
}

function drawnHunkLine(
  line: HunkLine,
  sides: FileSides,
  changed: Range[],
): DrawnLine {
  switch (line.kind) {
    case "context":
      return {
        kind: "context",
        tokens: paintWords(tokensAt(sides.new, line.newLine, line.code), []),
        anchor: { side: "after", line: line.newLine },
        beforeLine: line.oldLine ?? null,
      };
    case "added":
      return {
        kind: "added",
        tokens: paintWords(
          tokensAt(sides.new, line.newLine, line.code),
          changed,
        ),
        anchor: { side: "after", line: line.newLine },
        beforeLine: null,
      };
    case "removed":
      return {
        kind: "removed",
        tokens: paintWords(
          tokensAt(sides.old, line.oldLine, line.code),
          changed,
        ),
        anchor: { side: "before", line: line.oldLine },
        beforeLine: line.oldLine,
      };
    case "note":
      return { kind: "meta", text: line.text };
  }
}

/** The highlighted tokens for line `number` of a side, or the code as one
 *  plain token when the side has not loaded or does not say the same thing
 *  the patch does. */
function tokensAt(
  side: SourceFile | null,
  number: number,
  code: string,
): SyntaxToken[] {
  const tokens = side?.lines[number - 1];
  if (tokens?.map((token) => token.text).join("") === code) return tokens;
  return [{ text: code, kind: null }];
}
```

#### A line

Every line is commentable, pinned to a `LineAnchor`: a removed line by its
before-side number, every other by its after-side one. The gutter shows
after-side numbers, blank for a removed line, a hunk header, or git's
no-newline note.

Only the gutter is a control, so a line's text can be selected and copied.
A row-wide `<button>` would make the whole line open the composer, but
browsers will not select text inside one. A commentable line's gutter is
therefore the button, and a click anywhere else on the row opens the composer
too, unless it ended a text selection. A line either links or opens the
composer, never both. `LineAction` names the three things a line
can do, so a reviewed diff's lines comment and a linked one's gutters link
without a pair of optional props whose fourth combination draws nothing new.
Marking the addressed line is apart from the action: a pull request's stack
marks it in reviewed diffs too.

```tsx
//| id: frontend-view-diff-patch-line
//| file: src/frontend/views/DiffView/FileRow/PatchLine.tsx
import type { LineAnchor } from "../../../model/review";
import type { PaintedToken } from "../../../model/words";
import type { CodeKind, DrawnLine, Side } from "./drawnLines";
import { type FileLinks, follow } from "./links";

/** What reaching for a line does. */
export type LineAction =
  /** Nothing: the line is static. */
  | { kind: "none" }
  /** The gutter number of an after-side line links to it. */
  | { kind: "link"; links: FileLinks }
  /** The gutter is a `<button>` that opens the composer on the line, and
   *  so is a click on the rest of the row. */
  | { kind: "comment"; onOpenComposer: (anchor: LineAnchor) => void };

/** One line of a patch. In a column a line is numbered by that column's
 *  side, and opens the composer only in the column of the side it is
 *  anchored to, so each line is commented on from one place. */
export function PatchLine({
  line,
  side,
  action,
  selected,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
  side?: Side;
  action: LineAction;
  /** The after-side line the address names, if any. */
  selected: number | null;
}) {
  const anchor =
    "anchor" in line && (side === undefined || line.anchor.side === side)
      ? line.anchor
      : null;
  const afterLine = anchor?.side === "after" ? anchor.line : null;
  const number =
    side === "before" && "beforeLine" in line ? line.beforeLine : afterLine;
  const gutter = <span className="diff-line__gutter">{number ?? ""}</span>;
  const text =
    "text" in line ? (
      <span className={`diff-line__text--${line.kind}`}>
        {line.text === "" ? " " : line.text}
      </span>
    ) : (
      <span>
        <span className="diff-line__sign">{SIGNS[line.kind]}</span>
        {line.tokens.map((token, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering tokens
            key={index}
            className={tokenClass(token)}
          >
            {token.text}
          </span>
        ))}
      </span>
    );
  const marked =
    afterLine !== null && selected === afterLine ? " diff-line--selected" : "";
  const column = side === undefined ? "" : ` diff-line--${side}`;
  const className = `diff-line diff-line--${line.kind}${column}${marked}`;

  switch (action.kind) {
    case "none":
      return (
        <div className={className}>
          {gutter}
          {text}
        </div>
      );
    case "link": {
      const { links } = action;
      return (
        <div className={className}>
          {afterLine === null ? (
            gutter
          ) : (
            <a
              href={links.href(afterLine)}
              onClick={(event) =>
                follow(event, () => links.onFollow(afterLine))
              }
              className="diff-line__gutter diff-line__anchor"
            >
              {afterLine}
            </a>
          )}
          {text}
        </div>
      );
    }
    case "comment": {
      const { onOpenComposer } = action;
      return anchor === null ? (
        <div className={className}>
          {gutter}
          {text}
        </div>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the gutter button is the keyboard path
        <div
          onClick={() => {
            if (window.getSelection()?.isCollapsed === false) return;
            onOpenComposer(anchor);
          }}
          className={`${className} diff-line--interactive`}
        >
          <button
            type="button"
            aria-label={`comment on ${anchor.side} line ${anchor.line}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenComposer(anchor);
            }}
            className="diff-line__gutter diff-line__comment"
          >
            {number ?? ""}
          </button>
          {text}
        </div>
      );
    }
  }
}

/** The other column's half of a row whose line is only on one side. */
export function EmptyCell({ side }: { side: Side }) {
  return <div className={`diff-line diff-line--${side} diff-line--empty`} />;
}

function tokenClass(token: PaintedToken): string | undefined {
  const classes = [
    token.kind === null ? null : `syntax--${token.kind}`,
    token.changed ? "diff-line__changed" : null,
  ].filter((name) => name !== null);
  return classes.length === 0 ? undefined : classes.join(" ");
}

const SIGNS: Record<CodeKind, string> = {
  context: " ",
  added: "+",
  removed: "-",
};
```

### Comments

A thread is a conversation: the comment, then its
[replies](review.md#review-state) oldest first, each under the same byline
of who wrote it and when. An agent's name stands out from the reader's own.
A thread written against a commit other than the one shown says what became
of it, and a line thread is labelled where its line is drawn now, as
[`drawnAt`](review.md#review-state) finds it in the file's patch. An open
thread ends in a reply field, so answering is one tap. A resolved thread
folds to a line naming where it is and how it began, since the reader has
finished with it but may still want to see what was agreed. The composer
and threads are their own view because commit rows and interdiff rows draw
them too, for comments on a whole comparison.

The reader can edit their own comments and replies in place, and delete
their own replies, but not an agent's. Rewriting an agent's message would
leave words under its name that it never wrote, and an agent reading the
thread back would take them as its own. Deleting one would leave a hole in a
conversation that the agent still remembers having.

```tsx
//| id: frontend-view-comments
//| file: src/frontend/views/Comments.tsx
import { useState } from "react";
import {
  type Anchor,
  drawnAt,
  type LineAnchor,
  type Reply,
  type RowComment,
} from "../model/review";

/** How a comment names its line: the after side's number alone, since that
 *  is the version being approved, and the before side's marked as such. */
function lineLabel({ side, line }: LineAnchor): string {
  return side === "after" ? `${line}` : `${line}, before`;
}

/** What a composer is writing about, where its file is already on screen. */
function composerLabel(anchor: Anchor): string {
  switch (anchor.kind) {
    case "line":
      return `line ${lineLabel(anchor)}`;
    case "file":
      return "whole file";
    case "comparison":
      return "whole comparison";
  }
}

/** Who wrote a comment. The browser writes as the reader, so the reader's
 *  own comments read as theirs and anyone else's by name. */
function authorLabel(author: string): string {
  return author === "reader" ? "you" : author;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** When a message was written, in the largest unit that has passed. */
function writtenAgo(createdAt: string, now: number): string {
  const seconds = (Date.parse(createdAt) - now) / 1000;
  if (Number.isNaN(seconds)) return "";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return RELATIVE.format(Math.trunc(seconds / size), unit);
    }
  }
  return "just now";
}

function messageCount(thread: RowComment): string {
  const count = 1 + thread.replies.length;
  return count === 1 ? "1 message" : `${count} messages`;
}

/** What a thread is about, named so it reads on its own: a line comment by
 *  where its line is drawn now, where the comparison draws it. */
function threadLabel(comment: Anchor, at: LineAnchor | null): string {
  switch (comment.kind) {
    case "line":
      return `${comment.path}:${lineLabel(at ?? comment)}`;
    case "file":
      return comment.path;
    case "comparison":
      return "whole comparison";
  }
}

export function CommentComposer({
  anchor,
  onCancel,
  onSubmit,
}: {
  anchor: Anchor;
  onCancel: () => void;
  onSubmit: (anchor: Anchor, body: string) => void;
}) {
  return (
    <Composer
      label={composerLabel(anchor)}
      submitLabel="comment"
      onCancel={onCancel}
      onSubmit={(body) => onSubmit(anchor, body)}
    />
  );
}

/** Every composer opens because the reader asked to write, so it takes the
 *  focus. A reply's needs no label: its thread is right above it. */
function Composer({
  label,
  initialBody = "",
  submitLabel,
  onCancel,
  onSubmit,
}: {
  label: string | null;
  initialBody?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState(initialBody);

  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSubmit(body);
      }}
    >
      {label !== null && <div className="comment-composer__line">{label}</div>}
      <textarea
        // biome-ignore lint/a11y/noAutofocus: it opens to be typed into
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="comment-composer__input"
      />
      <div className="comment-composer__actions">
        <button type="submit">{submitLabel}</button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

export function CommentThreads({
  comments,
  onEditComment,
  patch = "",
  onResolveComment,
  onDropComment,
  onReplyToComment,
  onEditReply,
  onDropReply,
}: {
  comments: RowComment[];
  /** The patch of the file line comments are on, to find their lines in. */
  patch?: string;
  onEditComment: (id: string, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
  onReplyToComment: (id: string, body: string) => void;
  onEditReply: (commentId: string, replyId: string, body: string) => void;
  onDropReply: (commentId: string, replyId: string) => void;
}) {
  if (comments.length === 0) return null;
  return (
    <div>
      {comments.map((comment) => (
        <CommentThread
          key={comment.id}
          comment={comment}
          onEdit={(body) => onEditComment(comment.id, body)}
          at={drawnAt(comment, patch)}
          onResolve={(resolved) => onResolveComment(comment.id, resolved)}
          onDrop={() => onDropComment(comment.id)}
          onReply={(body) => onReplyToComment(comment.id, body)}
          onEditReply={(reply, body) => onEditReply(comment.id, reply, body)}
          onDropReply={(reply) => onDropReply(comment.id, reply)}
        />
      ))}
    </div>
  );
}

function CommentThread({
  comment,
  onEdit,
  at,
  onResolve,
  onDrop,
  onReply,
  onEditReply,
  onDropReply,
}: {
  comment: RowComment;
  onEdit: (body: string) => void;
  at: LineAnchor | null;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
  onReply: (body: string) => void;
  onEditReply: (replyId: string, body: string) => void;
  onDropReply: (replyId: string) => void;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const tone = comment.resolved ? "resolved" : comment.stale ? "stale" : "open";

  if (comment.resolved && !unfolded) {
    return (
      <div className="comment-thread comment-thread--resolved">
        <button
          type="button"
          className="comment-thread__summary"
          aria-expanded={false}
          onClick={() => setUnfolded(true)}
        >
          <span aria-hidden="true">▸</span>
          <span className="review-chip review-chip--resolved">resolved</span>
          <span>{threadLabel(comment, at)}</span>
          <span>{messageCount(comment)}</span>
          <span className="comment-thread__excerpt">{comment.body}</span>
        </button>
      </div>
    );
  }

  const drift = driftNote(comment, at);

  return (
    <div className={`comment-thread comment-thread--${tone}`}>
      <div className="comment-thread__head">
        {comment.resolved && (
          <button
            type="button"
            className="comment-thread__action"
            aria-expanded={true}
            aria-label="fold thread"
            onClick={() => setUnfolded(false)}
          >
            ▾
          </button>
        )}
        <span className={`review-chip review-chip--${tone}`}>{tone}</span>
        <span className="comment-thread__where">
          {threadLabel(comment, at)}
        </span>
        <span>{messageCount(comment)}</span>
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
      </div>
      {drift !== null && <div className="comment-thread__stale">{drift}</div>}
      <Message
        message={comment}
        onEdit={comment.author === "reader" ? onEdit : null}
        onDrop={onDrop}
        dropLabel={comment.replies.length === 0 ? "delete" : "delete thread"}
      />
      {comment.replies.map((reply) => {
        const own = reply.author === "reader";
        return (
          <Message
            key={reply.id}
            message={reply}
            onEdit={own ? (body) => onEditReply(reply.id, body) : null}
            onDrop={own ? () => onDropReply(reply.id) : null}
          />
        );
      })}
      <ReplyField onReply={onReply} />
    </div>
  );
}

/** One message of a thread, with what the reader may do to it. */
function Message({
  message,
  onEdit,
  onDrop,
  dropLabel = "delete",
}: {
  message: RowComment | Reply;
  onEdit: ((body: string) => void) | null;
  onDrop: (() => void) | null;
  dropLabel?: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="comment-thread__message">
      <div className="comment-thread__byline">
        <Author author={message.author} />
        <span title={message.createdAt}>
          {writtenAgo(message.createdAt, Date.now())}
        </span>
        <span className="comment-thread__actions">
          {onEdit !== null && !editing && (
            <button
              type="button"
              className="comment-thread__action"
              onClick={() => setEditing(true)}
            >
              edit
            </button>
          )}
          {onDrop !== null && (
            <button
              type="button"
              className="comment-thread__action"
              onClick={onDrop}
            >
              {dropLabel}
            </button>
          )}
        </span>
      </div>
      {editing && onEdit !== null ? (
        <Composer
          label={null}
          initialBody={message.body}
          submitLabel="save"
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
        />
      ) : (
        <div className="comment-thread__body">{message.body}</div>
      )}
    </div>
  );
}

/** What became of what a comment was written against, or null when it is
 *  what the comparison shows. */
function driftNote(comment: RowComment, at: LineAnchor | null): string | null {
  const written = `written against ${comment.commitId.slice(0, 8)}`;
  if (comment.kind !== "line") {
    return comment.stale
      ? `${written}. That commit has since been rewritten.`
      : null;
  }
  const was = `line ${lineLabel(comment)}`;
  if (at === null) {
    return `${written}, at ${was}, which this comparison does not draw.`;
  }
  if (!comment.stale) return null;
  if (at.side === "before")
    return `${written}. That line has since been rewritten.`;
  return at.line === comment.line
    ? `${written}. That line is unchanged since.`
    : `${written}, at ${was}. That line is unchanged since and is now line ${at.line}.`;
}

function ReplyField({ onReply }: { onReply: (body: string) => void }) {
  const [replying, setReplying] = useState(false);

  return replying ? (
    <Composer
      label={null}
      submitLabel="reply"
      onCancel={() => setReplying(false)}
      onSubmit={(body) => {
        onReply(body);
        setReplying(false);
      }}
    />
  ) : (
    <div className="comment-thread__foot">
      <button
        type="button"
        className="comment-thread__start-reply"
        onClick={() => setReplying(true)}
      >
        reply...
      </button>
    </div>
  );
}

function Author({ author }: { author: string }) {
  return (
    <span
      className={
        author === "reader"
          ? "comment-thread__author"
          : "comment-thread__author comment-thread__author--other"
      }
    >
      {authorLabel(author)}
    </span>
  );
}
```

### Styling a file


Added and removed lines are tinted behind the text and only the sign takes
the colour, since the text carries [syntax colours](syntax.md#colours);
[changed words](#changed-words) take a stronger tint.

In the [side-by-side](#side-by-side) layout each column has its own gutter.
Only the column of the side a comment would be anchored to opens the
composer, so a context line has one button, not two, and only the after
column carries links. A structural context line with no before side sits in
the after column beside an empty cell. The layout is obeyed at every width,
and columns wrap rather than scroll so both sides of an edit stay level.

File headers stick at `--diff-sticky-top` (zero unless
[the file navigator](file-tree.md#stepping-through-files) holds the top), so
a long file keeps its name and view switch on screen.

```css
/*| id: design-diff-view
@layer components {
  .diff-view {
    padding: var(--space-5);
  }

  .file-summary {
    margin: 0 0 var(--space-6);
    border: 1px solid var(--border);
  }

  .file-summary__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-5);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .file-summary__title {
    margin-right: auto;
  }

  .file-summary__totals {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
    align-items: center;
    font-size: var(--text-size-small);
  }

  .file-summary__added {
    color: var(--diff-added);
  }

  .file-summary__removed {
    color: var(--diff-removed);
  }

  .file-summary__bar {
    display: flex;
    height: 4px;
    width: 100px;
    background: var(--border-subtle);
    border-radius: 2px;
    overflow: hidden;
  }

  .file-summary__bar-added {
    background: var(--diff-added);
  }

  .file-summary__bar-removed {
    background: var(--diff-removed);
  }

  .file-summary__tree {
    padding: var(--space-2) 0;
  }

  .diff-file {
    margin-bottom: var(--space-6);
    border: 1px solid var(--border);
    scroll-margin-top: var(--diff-sticky-top, 0);
  }

  .diff-file__header {
    position: sticky;
    top: var(--diff-sticky-top, 0);
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    row-gap: var(--space-2);
    align-items: baseline;
    padding: var(--space-2) var(--space-4);
    font-weight: bold;
    background: var(--surface-raised);
  }

  /* Wraps anywhere, but keeps 20ch: narrower, the header controls wrap to
     their own row instead of stacking the path a syllable a line. Asking for
     20ch rather than the whole path keeps desktop headers on one row. */
  .diff-file__path {
    flex: 1 1 20ch;
    min-width: min(20ch, 100%);
    overflow-wrap: anywhere;
  }

  .diff-file__modes {
    flex: none;
    display: flex;
    margin: 0 0 0 auto;
    padding: 0;
    border: none;
    font-weight: normal;
  }

  .diff-file__mode {
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    background: transparent;
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
  }

  .diff-file__mode + .diff-file__mode {
    border-left: none;
  }

  .diff-file__mode[aria-pressed="true"] {
    background: var(--surface-sunken);
    color: inherit;
  }

  .diff-file__mode:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .diff-file__comment {
    flex: none;
    margin-left: auto;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    background: transparent;
    font: inherit;
    font-weight: normal;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
  }

  .diff-file__modes + .diff-file__comment {
    margin-left: var(--space-3);
  }

  .diff-file__compare,
  .diff-file__uncompare {
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    background: transparent;
    font: inherit;
    font-weight: normal;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
  }

  .compare-with,
  .diff-file__uncompare {
    flex: none;
    margin-left: auto;
  }

  .diff-file__modes + .compare-with,
  .diff-file__modes + .diff-file__uncompare,
  .compare-with + .diff-file__comment,
  .diff-file__uncompare + .diff-file__comment {
    margin-left: var(--space-3);
  }

  .diff-file__status--compared {
    color: var(--status-renamed);
  }

  /* A sticky header is a stacking context, so the open list would sit under
     the next file's header without lifting its own. */
  .diff-file__header:has(.compare-with__sheet) {
    z-index: 3;
  }

  .compare-with__scrim {
    position: fixed;
    z-index: 3;
    inset: 0;
    padding: 0;
    border: none;
    background: transparent;
  }

  /* Hangs from the sticky header, not the button, which wraps to the left
     edge on a phone and would push a right-aligned list off the screen. */
  .compare-with__sheet {
    position: absolute;
    z-index: 4;
    top: calc(100% + var(--space-2));
    right: var(--space-4);
    width: min(420px, calc(100vw - 2 * var(--space-5)));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    font-weight: normal;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
  }

  .compare-with__head {
    flex: none;
    padding: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .compare-with__filter {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .compare-with__body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0 var(--space-4);
  }

  .compare-with__label,
  .compare-with__note {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-faint);
  }

  .compare-with__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .compare-with__option {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: var(--text);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    background: none;
    border: none;
  }

  .compare-with__option:hover,
  .compare-with__option:focus-visible {
    background: var(--surface-sunken);
  }

  .compare-with__dir {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
  }

  .diff-file__status {
    margin-right: var(--space-4);
    color: var(--text-muted);
  }

  .diff-file__toggle {
    flex: 1 1 30ch;
    min-width: 0;
    display: flex;
    align-items: baseline;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .diff-file__chevron {
    width: 1.5ch;
    flex: none;
    margin-right: var(--space-2);
    color: var(--text-muted);
  }

  .diff-file__viewed {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    font-weight: normal;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
  }

  .diff-file__modes + .diff-file__viewed,
  .diff-file__comment + .diff-file__viewed,
  .compare-with + .diff-file__viewed,
  .diff-file__uncompare + .diff-file__viewed {
    margin-left: var(--space-4);
  }

  .diff-file__reason {
    margin-left: var(--space-4);
    font-weight: normal;
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .diff-file__binary {
    padding: var(--space-4);
    font-style: italic;
    color: var(--text-muted);
  }

  .diff-file__patch {
    margin: 0;
    padding: var(--space-4);
    overflow-x: auto;
  }

  .diff-line {
    display: flex;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .diff-line--interactive {
    cursor: pointer;
  }

  .diff-line__comment {
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  .diff-line__comment:hover {
    color: var(--accent);
  }

  .diff-line--before {
    border-right: 1px solid var(--border-subtle);
  }

  .diff-line--empty {
    background: var(--surface-sunken);
  }

  .diff-file__patch--split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    overflow-x: visible;
  }

  .diff-file__patch--split > .diff-line {
    grid-column: 1 / -1;
  }

  .diff-file__patch--split > .diff-line--before,
  .diff-file__patch--split > .diff-line--after {
    grid-column: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff-line--added {
    background: var(--diff-added-surface);
  }

  .diff-line--removed {
    background: var(--diff-removed-surface);
  }

  .diff-line--gap {
    color: var(--diff-hunk);
    background: var(--surface-sunken);
    cursor: pointer;
  }

  .diff-line--added .diff-line__changed {
    background: var(--diff-added-emphasis);
  }

  .diff-line--removed .diff-line__changed {
    background: var(--diff-removed-emphasis);
  }

  .diff-line--added .diff-line__sign {
    color: var(--diff-added);
  }

  .diff-line--removed .diff-line__sign {
    color: var(--diff-removed);
  }

  .diff-line__gutter {
    width: var(--gutter-width);
    flex: none;
    margin-right: var(--space-4);
    text-align: right;
    color: var(--text-ghost);
    user-select: none;
  }

  .diff-file__path {
    color: inherit;
    text-decoration: none;
  }

  .diff-file__path:hover {
    text-decoration: underline;
  }

  .diff-file__header--selected {
    box-shadow: inset var(--border-width-accent) 0 var(--accent);
  }

  .diff-line--selected {
    box-shadow: inset var(--border-width-accent) 0 var(--accent);
  }

  .diff-line__anchor {
    text-decoration: none;
    cursor: pointer;
  }

  .diff-line__anchor:hover,
  .diff-line--selected .diff-line__anchor {
    color: var(--accent);
  }

  .diff-line__text--meta {
    color: var(--diff-meta);
  }

  .diff-line__text--hunk {
    color: var(--diff-hunk);
  }

  .comment-composer {
    padding: var(--space-4);
    border-top: 1px solid var(--border);
    background: var(--surface-sunken);
  }

  /* Sticks to the left edge so a patch scrolled sideways keeps its threads
     in view; keeps the line breaks a comment was written with. */
  .diff-file__line-comments {
    position: sticky;
    left: 0;
    grid-column: 1 / -1;
    margin: var(--space-2) 0;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .diff-file__line-comments button {
    overflow-wrap: normal;
  }

  /* Both sides of a side-by-side row read as one block of threads. */
  .diff-file__line-comments + .diff-file__line-comments {
    margin-top: calc(-1 * var(--space-2));
    border-top: none;
  }

  .comment-composer__line {
    margin-bottom: var(--space-2);
    color: var(--text-faint);
  }

  .comment-composer__input {
    width: 100%;
    font: inherit;
  }

  .comment-composer__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }
}
```

```css
/*| id: design-diff-view
@layer components-narrow {
  @media (max-width: 1000px) {
    /* As wide as the text or the pane, whichever is more, so a selected
       line's background reaches the edge and the patch scrolls sideways. */
    .diff-line {
      width: max-content;
      min-width: 100%;
    }

    .diff-file__patch--split > .diff-line--before,
    .diff-file__patch--split > .diff-line--after {
      width: auto;
      min-width: 0;
    }
  }
}
```

## Collapsed files

`collapseReason` reads only the path and patch, so it answers on the first
render and a file never folds under the reader later. Lock files go by name
(including any `.lock`), since a reviewer checks the manifest instead.
Generated files go by path or by a generator's marker in the first lines of
the after side the patch shows, so a new generated file is always caught and
a file merely mentioning the marker, like this one, is not. `LARGE_DIFF`
counts changed lines, not the file's length.

```ts
//| id: frontend-model-collapse
//| file: src/frontend/model/collapse.ts
import type { FileDiff } from "./diff";
import { readPatch } from "./patch";

/** Files a package manager writes and resolves on the author's behalf. */
const LOCK_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "deno.lock",
  "Cargo.lock",
  "flake.lock",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "Podfile.lock",
  "pubspec.lock",
  "packages.lock.json",
]);

/** Paths only a build step writes. */
const GENERATED_PATHS = [
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)dist\//,
  /\.pb\.go$/,
  /_pb2\.pyi?$/,
];

/** What a generator writes at the top of its output. */
const GENERATED_MARKER = /@generated|^\W*Code generated .* DO NOT EDIT\.?/;

/** How far down the after side a generator's marker is looked for. */
const MARKER_LINES = 5;

/** Changed lines past which a diff starts folded. */
export const LARGE_DIFF = 400;

/** Why a file starts folded, in the words its header shows, or `null` when
 *  it starts open. */
export function collapseReason(file: FileDiff): string | null {
  const path = "path" in file ? file.path : file.newPath;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (LOCK_FILES.has(name) || name.endsWith(".lock")) return "lock file";
  if (GENERATED_PATHS.some((pattern) => pattern.test(path))) return "generated";

  const lines = readPatch(file.patch).hunks.flatMap((hunk) => hunk.lines);
  const marked = lines.some(
    (line) =>
      line.kind !== "note" &&
      line.kind !== "removed" &&
      line.newLine <= MARKER_LINES &&
      GENERATED_MARKER.test(line.code),
  );
  if (marked) return "generated";

  const changed = lines.filter(
    (line) => line.kind === "added" || line.kind === "removed",
  ).length;
  if (changed > LARGE_DIFF) return `large diff, ${changed} changed lines`;
  return null;
}
```

### Test

```ts
//| id: frontend-model-collapse-test
//| file: src/frontend/model/collapse.test.ts
import { describe, expect, test } from "bun:test";
import { collapseReason, LARGE_DIFF } from "./collapse";
import type { FileDiff } from "./diff";

function modified(path: string, patch: string): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch,
    structural: { kind: "unavailable", reason: "test" },
  };
}

function added(path: string, lines: string[]): FileDiff {
  return {
    status: "added",
    path,
    binary: false,
    oldBlob: null,
    newBlob: "b",
    structural: { kind: "unavailable", reason: "test" },
    patch: [
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "",
    ].join("\n"),
  };
}

const SMALL = "@@ -1,2 +1,2 @@\n-old\n+new\n keep\n";

describe("collapseReason", () => {
  test("folds a lock file by its name, wherever it sits", () => {
    expect(collapseReason(modified("bun.lock", SMALL))).toBe("lock file");
    expect(collapseReason(modified("crates/x/Cargo.lock", SMALL))).toBe(
      "lock file",
    );
    expect(collapseReason(modified("tools/some.lock", SMALL))).toBe(
      "lock file",
    );
  });

  test("folds a path only a build step writes", () => {
    expect(collapseReason(modified("dist/app.js", SMALL))).toBe("generated");
    expect(collapseReason(modified("web/app.min.js", SMALL))).toBe("generated");
  });

  test("folds a new file whose top carries a generator's marker", () => {
    // arrange
    const file = added("api/types.go", [
      "// Code generated by protoc-gen-go. DO NOT EDIT.",
      "package api",
    ]);

    // act
    const reason = collapseReason(file);

    // assert
    expect(reason).toBe("generated");
  });

  test("leaves open a file that mentions the marker further down", () => {
    // arrange
    const file = added("src/marker.ts", [
      ...Array.from({ length: 10 }, () => "// ordinary"),
      'const MARKER = "@generated";',
    ]);

    // act
    const reason = collapseReason(file);

    // assert
    expect(reason).toBeNull();
  });

  test("folds a diff with more changed lines than the limit", () => {
    // arrange
    const lines = Array.from({ length: LARGE_DIFF + 1 }, (_, n) => `l${n}`);

    // act
    const reason = collapseReason(added("src/big.ts", lines));

    // assert
    expect(reason).toBe(`large diff, ${LARGE_DIFF + 1} changed lines`);
  });

  test("leaves an ordinary change open", () => {
    expect(collapseReason(modified("src/app.ts", SMALL))).toBeNull();
  });
});
```

## Comparing two files by hand

jj pairs a row's files by path, so a rename it did not detect reads as one
file deleted and another added, and a file split in two reads as one file
shrinking and another appearing. A reader can read any after-side file of a
row against any before-side file instead. The choice is kept in the
[review document](review.md#review-state) under the row's key, by path, so
it survives a reload and follows the change through an amend, the way a
comment does.

A compared pair takes the place of the after-side file's own diff and keeps
everything else as it is: the deleted or shrunk original stays in the list,
naming where it went. Showing the pair beside the file's own diff would make
an added file appear twice with every line added the second time. The
compared diff is a rename to every reader downstream, filed under
`old → new`, so its comments and `Viewed` mark need nothing new; they stay
with the pair, and putting the file's own diff back leaves them unshown,
as it would a rename's.

The swap happens in the controller, before anything counts or draws a file,
so the files summary, the [navigator](file-tree.md#stepping-through-files),
and the sources that expand hidden lines all see the pair. A file whose
compared diff has not arrived, or could not be made (its old path is gone
after a rewrite), shows its own diff in the meantime.

```ts
//| id: frontend-model-compared
//| file: src/frontend/model/compared.ts
import type { AsyncState } from "./asyncState";
import { afterPathOf } from "./changedFiles";
import type { FileDiff } from "./diff";
import type { CompareOffer, ComparisonReview, ReviewActions } from "./review";

/** One file of a row read against another, as the server is asked for it:
 *  `oldPath` on the before side, `newPath` on the after side. */
export interface CompareAsk {
  fromCommit: string | null;
  toCommit: string;
  oldPath: string;
  newPath: string;
}

export function compareKey(ask: CompareAsk): string {
  return JSON.stringify([
    ask.fromCommit,
    ask.toCommit,
    ask.oldPath,
    ask.newPath,
  ]);
}

/** A compared diff, or null while nobody has asked for it. */
export type ComparedLookup = (ask: CompareAsk) => AsyncState<FileDiff> | null;

/** Every path a row's before side holds, asked for when the reader first
 *  looks for one. */
export interface BeforePaths {
  get: (
    fromCommit: string | null,
    toCommit: string,
  ) => AsyncState<string[]> | null;
  want: (fromCommit: string | null, toCommit: string) => void;
}

/** What a row's compared files ask the server. A row with no after side
 *  has nothing to compare. */
export function compareAsks(row: ComparisonReview): CompareAsk[] {
  const { fromCommitId, toCommitId } = row;
  if (toCommitId === null) return [];
  return row.compared.map(({ oldPath, newPath }) => ({
    fromCommit: fromCommitId,
    toCommit: toCommitId,
    oldPath,
    newPath,
  }));
}

/** What a row offers its files to compare with. A row with no after side
 *  has nothing to compare. */
export function compareOffer(
  row: ComparisonReview,
  beforePaths: BeforePaths,
  compare: ReviewActions["compare"],
): CompareOffer | null {
  const { fromCommitId, toCommitId } = row;
  if (toCommitId === null) return null;
  return {
    compared: row.compared,
    beforePaths: beforePaths.get(fromCommitId, toCommitId),
    onWantBeforePaths: () => beforePaths.want(fromCommitId, toCommitId),
    onCompare: (newPath, oldPath) => compare(row, newPath, oldPath),
  };
}

/** `files` with each file the reader compared swapped for its compared
 *  diff, once that has arrived. */
export function withCompared(
  files: FileDiff[],
  asks: CompareAsk[],
  lookup: ComparedLookup,
): FileDiff[] {
  return files.map((file) => {
    if (file.status === "deleted") return file;
    const ask = asks.find((each) => each.newPath === afterPathOf(file));
    const answer = ask === undefined ? null : lookup(ask);
    return answer?.status === "ready" ? answer.data : file;
  });
}

/** What a file can be compared with, and what it is compared with now. */
export interface FileCompare {
  /** The before-side path the file is read against, or null for its own
   *  diff. */
  against: string | null;
  /** The before-side paths the row's own files name. */
  inRow: string[];
  /** The whole before tree, or null until it is asked for. */
  beforePaths: AsyncState<string[]> | null;
  onWantBeforePaths: () => void;
  /** Null puts the file's own diff back. */
  onCompare: (oldPath: string | null) => void;
}

/** The before-side paths a row's own files name, which the picker offers
 *  first. */
export function beforePathsOf(files: FileDiff[]): string[] {
  return files.flatMap((file) => {
    if (file.status === "added") return [];
    return ["path" in file ? file.path : file.oldPath];
  });
}
```

### Test

```ts
//| id: frontend-model-compared-test
//| file: src/frontend/model/compared.test.ts
import { describe, expect, test } from "bun:test";
import { type CompareAsk, compareAsks, withCompared } from "./compared";
import type { FileDiff } from "./diff";
import { EMPTY_REVIEW, reviewComparison } from "./review";

const fields = {
  binary: false,
  patch: "",
  structural: { kind: "unavailable", reason: "test" },
} as const;

const deleted: FileDiff = {
  status: "deleted",
  path: "a.ts",
  oldBlob: "1",
  newBlob: null,
  ...fields,
};
const added: FileDiff = {
  status: "added",
  path: "b.ts",
  oldBlob: null,
  newBlob: "2",
  ...fields,
};
const pair: FileDiff = {
  status: "compared",
  oldPath: "a.ts",
  newPath: "b.ts",
  oldBlob: "1",
  newBlob: "2",
  ...fields,
};
const ask: CompareAsk = {
  fromCommit: null,
  toCommit: "c",
  oldPath: "a.ts",
  newPath: "b.ts",
};

describe("withCompared", () => {
  test("swaps a compared file for its pair once it arrives", () => {
    // arrange
    const lookup = () => ({ status: "ready", data: pair }) as const;

    // act
    const files = withCompared([deleted, added], [ask], lookup);

    // assert
    expect(files).toEqual([deleted, pair]);
  });

  test("keeps the file's own diff while the pair is on its way", () => {
    // arrange
    const lookup = () => ({ status: "loading" }) as const;

    // act
    const files = withCompared([deleted, added], [ask], lookup);

    // assert
    expect(files).toEqual([deleted, added]);
  });

  test("never swaps a deleted file, which has no after side", () => {
    // arrange
    const lookup = () => ({ status: "ready", data: pair }) as const;
    const onDeleted = { ...ask, newPath: "a.ts" };

    // act
    const files = withCompared([deleted], [onDeleted], lookup);

    // assert
    expect(files).toEqual([deleted]);
  });
});

describe("compareAsks", () => {
  test("asks nothing of a row with no after side", () => {
    // arrange
    const document = {
      ...EMPTY_REVIEW,
      compared: [{ reviewKey: "k", oldPath: "a.ts", newPath: "b.ts" }],
    };

    // act
    const asks = compareAsks(reviewComparison(document, "k", "x", null, null));

    // assert
    expect(asks).toEqual([]);
  });

  test("asks for each pair under the row's key, between its commits", () => {
    // arrange
    const document = {
      ...EMPTY_REVIEW,
      compared: [
        { reviewKey: "k", oldPath: "a.ts", newPath: "b.ts" },
        { reviewKey: "other", oldPath: "c.ts", newPath: "d.ts" },
      ],
    };

    // act
    const asks = compareAsks(reviewComparison(document, "k", "x", "y", null));

    // assert
    expect(asks).toEqual([
      { fromCommit: "x", toCommit: "y", oldPath: "a.ts", newPath: "b.ts" },
    ]);
  });
});
```

`useCompared` fetches each pair once, the way
[`useSources`](syntax.md) fetches each side, and `useBeforePaths` fetches a
row's tree only when the reader opens the picker on it: listing a whole tree
for every row on screen would cost a git process each for a list that is
usually never looked at.

```ts
//| id: frontend-state-compared
//| file: src/frontend/state/compared.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBeforePaths, fetchCompared } from "../api";
import type { AsyncState } from "../model/asyncState";
import {
  type BeforePaths,
  type CompareAsk,
  type ComparedLookup,
  compareKey,
} from "../model/compared";
import type { FileDiff } from "../model/diff";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCompared(asks: CompareAsk[]): ComparedLookup {
  const [loaded, setLoaded] = useState<
    ReadonlyMap<string, AsyncState<FileDiff>>
  >(() => new Map());
  const asked = useRef(new Set<string>());
  const wanted = JSON.stringify(asks);

  useEffect(() => {
    for (const ask of JSON.parse(wanted) as CompareAsk[]) {
      const key = compareKey(ask);
      if (asked.current.has(key)) continue;
      asked.current.add(key);

      const put = (state: AsyncState<FileDiff>) =>
        setLoaded((now) => new Map(now).set(key, state));
      put({ status: "loading" });
      fetchCompared(ask).then(
        (file) => put({ status: "ready", data: file }),
        (error: unknown) => put({ status: "error", message: messageOf(error) }),
      );
    }
  }, [wanted]);

  return useCallback((ask) => loaded.get(compareKey(ask)) ?? null, [loaded]);
}

function keyOf(fromCommit: string | null, toCommit: string): string {
  return `${fromCommit ?? ""}:${toCommit}`;
}

export function useBeforePaths(): BeforePaths {
  const [loaded, setLoaded] = useState<
    ReadonlyMap<string, AsyncState<string[]>>
  >(() => new Map());
  const asked = useRef(new Set<string>());

  const want = useCallback((fromCommit: string | null, toCommit: string) => {
    const key = keyOf(fromCommit, toCommit);
    if (asked.current.has(key)) return;
    asked.current.add(key);

    const put = (state: AsyncState<string[]>) =>
      setLoaded((now) => new Map(now).set(key, state));
    put({ status: "loading" });
    fetchBeforePaths(fromCommit, toCommit).then(
      (paths) => put({ status: "ready", data: paths }),
      (error: unknown) => put({ status: "error", message: messageOf(error) }),
    );
  }, []);

  const get = useCallback(
    (fromCommit: string | null, toCommit: string) =>
      loaded.get(keyOf(fromCommit, toCommit)) ?? null,
    [loaded],
  );

  return { get, want };
}
```

## Reading a patch

`readPatch` splits a file's patch into header lines and hunks, numbering
each line from its `@@` header. The line union says which numbers a kind
has. A context line's `beforeLine` is optional only for
[structural](../backend/difft.md#from-chunks-to-hunks) context with no before
side. git's no-newline note is a kind of its own, and the patch's trailing
newline is dropped so it does not read as an empty last line.

```ts
//| id: frontend-model-patch
//| file: src/frontend/model/patch.ts
/** A file's patch read into the hunks it is made of. */
export interface Patch {
  /** Everything above the first hunk: `diff --git`, `index`, `---`, `+++`,
   *  and any mode or rename lines. */
  header: string[];
  hunks: Hunk[];
}

export interface Hunk {
  /** The `@@ -a,b +c,d @@` line, with whatever context git printed after it. */
  header: string;
  /** The after-side number of the hunk's first line, or of the line that
   *  would follow it when the hunk only removes. */
  newStart: number;
  /** The same on the before side, where the hunk says. */
  oldStart?: number;
  lines: HunkLine[];
}

/** A line inside a hunk. `code` is the line without its `+`, `-`, or space,
 *  and line numbers count from 1, as each side's file has them. A context
 *  line has no `oldLine` when it has no before-side partner, which only a
 *  structural hunk has. */
export type HunkLine =
  | { kind: "context"; code: string; newLine: number; oldLine?: number }
  | { kind: "removed"; code: string; oldLine: number }
  | { kind: "added"; code: string; newLine: number }
  | { kind: "note"; text: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Where a side's count starts. A side with no lines in the hunk names the
 *  line before the hunk, so its next line is one further on. */
function firstLine(start: string | undefined, count: string | undefined) {
  return Number(start) + (count === "0" ? 1 : 0);
}

export function readPatch(patch: string): Patch {
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let oldLine = 0;
  let newLine = 0;

  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();

  for (const text of lines) {
    const start = text.match(HUNK_HEADER);
    if (start !== null) {
      oldLine = firstLine(start[1], start[2]);
      newLine = firstLine(start[3], start[4]);
      hunks.push({
        header: text,
        newStart: newLine,
        oldStart: oldLine,
        lines: [],
      });
      continue;
    }

    const hunk = hunks.at(-1);
    if (hunk === undefined) {
      header.push(text);
      continue;
    }

    const code = text.slice(1);
    if (text.startsWith("+")) {
      hunk.lines.push({ kind: "added", code, newLine: newLine++ });
    } else if (text.startsWith("-")) {
      hunk.lines.push({ kind: "removed", code, oldLine: oldLine++ });
    } else if (text.startsWith("\\")) {
      hunk.lines.push({ kind: "note", text });
    } else {
      hunk.lines.push({
        kind: "context",
        code,
        newLine: newLine++,
        oldLine: oldLine++,
      });
    }
  }

  return { header, hunks };
}

/** Where line `line` of a patch's before side is drawn: on the after side
 *  where the patch keeps it, shifted by the lines added and removed above
 *  it, or on the before side where the patch removes it. */
export function followLine(
  patch: Patch,
  line: number,
): { side: "before" | "after"; line: number } {
  let shift = 0;
  for (const hunk of patch.hunks) {
    if (hunk.oldStart !== undefined && hunk.oldStart > line) break;
    for (const hunkLine of hunk.lines) {
      if (!("oldLine" in hunkLine) || hunkLine.oldLine !== line) continue;
      return hunkLine.kind === "removed"
        ? { side: "before", line }
        : { side: "after", line: hunkLine.newLine };
    }
    for (const hunkLine of hunk.lines) {
      if (hunkLine.kind === "added") shift += 1;
      if (hunkLine.kind === "removed") shift -= 1;
    }
  }
  return { side: "after", line: line + shift };
}
```

### Test

```ts
//| id: frontend-model-patch-test
//| file: src/frontend/model/patch.test.ts
import { describe, expect, test } from "bun:test";
import { followLine, gapsOf, readPatch } from "./patch";

describe("readPatch", () => {
  test("numbers each line on the sides it is on", () => {
    // arrange
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "index 1111111..2222222 100644",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -10,3 +10,3 @@ function f() {",
      " keep",
      "-old",
      "+new",
      " keep",
      "",
    ].join("\n");

    // act
    const { header, hunks } = readPatch(patch);

    // assert
    expect(header).toHaveLength(4);
    expect(hunks).toEqual([
      {
        header: "@@ -10,3 +10,3 @@ function f() {",
        newStart: 10,
        oldStart: 10,
        lines: [
          { kind: "context", code: "keep", newLine: 10, oldLine: 10 },
          { kind: "removed", code: "old", oldLine: 11 },
          { kind: "added", code: "new", newLine: 11 },
          { kind: "context", code: "keep", newLine: 12, oldLine: 12 },
        ],
      },
    ]);
  });

  test("restarts the count at every hunk header", () => {
    // arrange
    const patch = ["@@ -1 +1 @@", "-a", "+b", "@@ -40,0 +41 @@", "+c"].join(
      "\n",
    );

    // act
    const { hunks } = readPatch(patch);

    // assert
    expect(hunks[1]?.lines).toEqual([
      { kind: "added", code: "c", newLine: 41 },
    ]);
  });

  test("gives a missing-newline note no line of its own", () => {
    // arrange
    const patch = [
      "@@ -1 +1 @@",
      "-a",
      "\\ No newline at end of file",
      "+a",
      " b",
    ].join("\n");

    // act
    const lines = readPatch(patch).hunks[0]?.lines;

    // assert
    expect(lines).toEqual([
      { kind: "removed", code: "a", oldLine: 1 },
      { kind: "note", text: "\\ No newline at end of file" },
      { kind: "added", code: "a", newLine: 1 },
      { kind: "context", code: "b", newLine: 2, oldLine: 2 },
    ]);
  });

  test("reads a patch with no hunks as all header", () => {
    // arrange
    const patch = "diff --git a/b.bin b/b.bin\nBinary files differ\n";

    // act
    const { header, hunks } = readPatch(patch);

    // assert
    expect(header).toEqual([
      "diff --git a/b.bin b/b.bin",
      "Binary files differ",
    ]);
    expect(hunks).toEqual([]);
  });
});

describe("followLine", () => {
  const patch = readPatch(
    [
      "@@ -2,0 +3,2 @@",
      "+one",
      "+two",
      "@@ -8,3 +10,2 @@",
      " keep",
      "-gone",
      " keep",
      "",
    ].join("\n"),
  );

  test("leaves a line above every hunk where it was", () => {
    expect(followLine(patch, 2)).toEqual({ side: "after", line: 2 });
  });

  test("shifts a line below an insertion by what it inserts", () => {
    expect(followLine(patch, 3)).toEqual({ side: "after", line: 5 });
  });

  test("reads a context line's new number off its hunk", () => {
    expect(followLine(patch, 10)).toEqual({ side: "after", line: 11 });
  });

  test("keeps a removed line on the before side", () => {
    expect(followLine(patch, 9)).toEqual({ side: "before", line: 9 });
  });

  test("shifts a line below every hunk by what all of them add and remove", () => {
    expect(followLine(patch, 20)).toEqual({ side: "after", line: 21 });
  });
});
```

### Hidden lines

`gapsOf` names what the patch left out, on the after side (hidden lines are
unchanged, and comments anchor there), once the after side's length is known.
A gap's before-side start is known only when the hunks give one, which
structural hunks do not. A side too short for the hunks gives empty gaps,
never negative ones.

```ts
//| id: frontend-model-patch

/** Unchanged after-side lines the patch left out, `count` of them from line
 *  `start` on, which is line `oldStart` on the before side. */
export interface Gap {
  start: number;
  count: number;
  oldStart: number | null;
}

/** One gap before each hunk and one after the last, empty where the hunks
 *  already meet or reach the end, for an after side `length` lines long. */
export function gapsOf(patch: Patch, length: number): Gap[] {
  const gaps: Gap[] = [];
  let next = 1;
  let oldNext: number | null = 1;

  for (const hunk of patch.hunks) {
    const count = Math.max(0, hunk.newStart - next);
    gaps.push({
      start: next,
      count,
      oldStart: hunk.oldStart === undefined ? null : hunk.oldStart - count,
    });
    next =
      hunk.newStart + hunk.lines.filter((line) => "newLine" in line).length;
    oldNext =
      hunk.oldStart === undefined
        ? null
        : hunk.oldStart + hunk.lines.filter((line) => "oldLine" in line).length;
  }
  gaps.push({
    start: next,
    count: Math.max(0, length - next + 1),
    oldStart: oldNext,
  });

  return gaps;
}
```

```ts
//| id: frontend-model-patch-test

describe("gapsOf", () => {
  test("names the lines before, between, and after the hunks", () => {
    // arrange
    const patch = readPatch(
      [
        "@@ -4,2 +4,2 @@",
        " a",
        "-b",
        "+c",
        "@@ -20,1 +20,2 @@",
        " d",
        "+e",
      ].join("\n"),
    );

    // act
    const gaps = gapsOf(patch, 30);

    // assert
    expect(gaps).toEqual([
      { start: 1, count: 3, oldStart: 1 },
      { start: 6, count: 14, oldStart: 6 },
      { start: 22, count: 9, oldStart: 21 },
    ]);
  });

  test("resumes after a hunk that only removes", () => {
    // arrange
    const patch = readPatch(["@@ -5,2 +4,0 @@", "-a", "-b"].join("\n"));

    // act
    const gaps = gapsOf(patch, 10);

    // assert
    expect(gaps).toEqual([
      { start: 1, count: 4, oldStart: 1 },
      { start: 5, count: 6, oldStart: 7 },
    ]);
  });

  test("finds nothing hidden in a file the hunk covers whole", () => {
    // arrange
    const patch = readPatch(["@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"));

    // act
    // assert
    expect(gapsOf(patch, 2).map((gap) => gap.count)).toEqual([0, 0]);
  });
});
```

## Changed words

An edited line arrives as a removed and an added line that are mostly the
same, so the words that changed get a stronger tint. `changedLines` pairs a
run of removed lines with the run of added lines after it, first with first.
`changedWords` compares a pair word by word (a word is a run of letters and
digits, a run of whitespace, or one other character), so `oldPath` against
`newPath` is one change, not scattered letters. A pair sharing less than
`MIN_SHARED` was rewritten and gets no marks, as does one past `MAX_CELLS`.

Difftastic names a structural line's changed tokens itself; `markable` drops
them once they cover the reader's [word mark limit](settings.md#display) of
the line's words. For a file difftastic compared as text (its language name
starts with `Text`, such as Markdown), it marks whole lines, so those files
take their words from `changedLines` instead. Keying on the language rather
than on whole-line ranges keeps a parsed line difftastic really rewrote from
being re-paired. `paintWords` cuts syntax tokens at the ranges.

```ts
//| id: frontend-model-words
//| file: src/frontend/model/words.ts

import type { HunkLine } from "./patch";
import type { SyntaxKind, SyntaxToken } from "./source";

/** Characters `start` up to, not including, `end` of a line. */
export interface Range {
  start: number;
  end: number;
}

/** A piece of a syntax token, marked when its characters changed. */
export interface PaintedToken {
  text: string;
  kind: SyntaxKind | null;
  changed: boolean;
}

/** Below this share of the longer line in common, a pair is a rewrite. */
export const MIN_SHARED = 0.4;
/** The largest comparison table worth filling for one pair of lines. */
export const MAX_CELLS = 40_000;

const WORD = /\w+|\s+|[^\w\s]/g;

/** The changed ranges of every paired line in a hunk, by index in `lines`. */
export function changedLines(lines: HunkLine[]): Map<number, Range[]> {
  const ranges = new Map<number, Range[]>();
  let index = 0;

  while (index < lines.length) {
    const removed: number[] = [];
    while (lines[index]?.kind === "removed") removed.push(index++);
    const added: number[] = [];
    while (lines[index]?.kind === "added") added.push(index++);
    if (removed.length === 0 && added.length === 0) index++;

    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const before = removed[pair] as number;
      const after = added[pair] as number;
      const words = changedWords(codeOf(lines[before]), codeOf(lines[after]));
      if (words === null) continue;
      ranges.set(before, words.old);
      ranges.set(after, words.new);
    }
  }

  return ranges;
}

function codeOf(line: HunkLine | undefined): string {
  return line === undefined || line.kind === "note" ? "" : line.code;
}

/** The ranges of each line outside what the two share, or null when the two
 *  have too little in common, or are too long, to be worth marking. */
export function changedWords(
  before: string,
  after: string,
): { old: Range[]; new: Range[] } | null {
  const a = before.match(WORD) ?? [];
  const b = after.match(WORD) ?? [];
  if (a.length * b.length > MAX_CELLS) return null;

  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = common[i] as number[];
      const next = common[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const kept = { a: new Set<number>(), b: new Set<number>() };
  let shared = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      shared += (a[i] as string).length;
      kept.a.add(i++);
      kept.b.add(j++);
    } else if (
      (common[i + 1]?.[j] as number) >= (common[i]?.[j + 1] as number)
    ) {
      i++;
    } else {
      j++;
    }
  }

  if (shared < MIN_SHARED * Math.max(before.length, after.length)) {
    return null;
  }
  return { old: rangesOutside(a, kept.a), new: rangesOutside(b, kept.b) };
}

/** Character ranges of the words not in `kept`, neighbours merged. */
function rangesOutside(words: string[], kept: Set<number>): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  words.forEach((word, index) => {
    const end = offset + word.length;
    if (!kept.has(index)) {
      const last = ranges.at(-1);
      if (last !== undefined && last.end === offset) last.end = end;
      else ranges.push({ start: offset, end });
    }
    offset = end;
  });
  return ranges;
}

/** `tokens` cut at the edges of `ranges`, each piece marked when it falls
 *  inside one. */
export function paintWords(
  tokens: SyntaxToken[],
  ranges: Range[],
): PaintedToken[] {
  const painted: PaintedToken[] = [];
  let offset = 0;

  for (const token of tokens) {
    const end = offset + token.text.length;
    const cuts = new Set([offset, end]);
    for (const range of ranges) {
      if (range.start > offset && range.start < end) cuts.add(range.start);
      if (range.end > offset && range.end < end) cuts.add(range.end);
    }

    const edges = [...cuts].sort((x, y) => x - y);
    for (let edge = 0; edge < edges.length - 1; edge++) {
      const start = edges[edge] as number;
      const stop = edges[edge + 1] as number;
      painted.push({
        text: token.text.slice(start - offset, stop - offset),
        kind: token.kind,
        changed: ranges.some(
          (range) => range.start <= start && stop <= range.end,
        ),
      });
    }
    offset = end;
  }

  return painted;
}

/** `ranges`, or none when they cover `limit` or more of the words in
 *  `code`, as a share of them. */
export function markable(
  code: string,
  ranges: Range[],
  limit: number,
): Range[] {
  let words = 0;
  let changed = 0;
  let offset = 0;
  for (const word of code.match(WORD) ?? []) {
    const end = offset + word.length;
    if (word.trim() !== "") {
      words++;
      if (ranges.some((range) => range.start < end && offset < range.end)) {
        changed++;
      }
    }
    offset = end;
  }
  return changed < limit * words ? ranges : [];
}
```

### Test

```ts
//| id: frontend-model-words-test
//| file: src/frontend/model/words.test.ts
import { describe, expect, test } from "bun:test";
import type { HunkLine } from "./patch";
import { changedLines, changedWords, markable, paintWords } from "./words";

describe("changedWords", () => {
  test("marks the words an edit changed on each side", () => {
    // arrange
    // act
    const ranges = changedWords(
      "return { status, path, patch };",
      "return { status, path, oldBlob, patch };",
    );

    // assert
    expect(ranges).toEqual({ old: [], new: [{ start: 23, end: 32 }] });
  });

  test("marks a renamed word whole rather than letter by letter", () => {
    // arrange
    // act
    const ranges = changedWords("const oldPath = 1;", "const newPath = 1;");

    // assert
    expect(ranges).toEqual({
      old: [{ start: 6, end: 13 }],
      new: [{ start: 6, end: 13 }],
    });
  });

  test("marks nothing in a pair that was rewritten", () => {
    // arrange
    // act
    // assert
    expect(changedWords("import a from 'b';", "}")).toBeNull();
  });
});

describe("changedLines", () => {
  test("pairs removed lines with the added run after them, in order", () => {
    // arrange
    const lines: HunkLine[] = [
      { kind: "context", code: "keep", newLine: 1 },
      { kind: "removed", code: "let a = 1;", oldLine: 2 },
      { kind: "removed", code: "let b = 2;", oldLine: 3 },
      { kind: "added", code: "let a = 10;", newLine: 2 },
      { kind: "added", code: "extra line", newLine: 3 },
      { kind: "added", code: "one more", newLine: 4 },
    ];

    // act
    const ranges = changedLines(lines);

    // assert: `let b` against `extra line` is a rewrite, and `one more`
    // has no removed line to be compared with.
    expect([...ranges.keys()].sort()).toEqual([1, 3]);
    expect(ranges.get(1)).toEqual([{ start: 8, end: 9 }]);
    expect(ranges.get(3)).toEqual([{ start: 8, end: 10 }]);
  });

  test("pairs nothing across a context line", () => {
    // arrange
    const lines: HunkLine[] = [
      { kind: "removed", code: "let a = 1;", oldLine: 1 },
      { kind: "context", code: "keep", newLine: 1 },
      { kind: "added", code: "let a = 2;", newLine: 2 },
    ];

    // act
    // assert
    expect(changedLines(lines).size).toBe(0);
  });
});

describe("paintWords", () => {
  test("cuts tokens at the edges of a changed range", () => {
    // arrange
    const tokens = [
      { text: "const", kind: "keyword" as const },
      { text: " newPath = 1;", kind: null },
    ];

    // act
    const painted = paintWords(tokens, [{ start: 6, end: 13 }]);

    // assert
    expect(painted).toEqual([
      { text: "const", kind: "keyword", changed: false },
      { text: " ", kind: null, changed: false },
      { text: "newPath", kind: null, changed: true },
      { text: " = 1;", kind: null, changed: false },
    ]);
  });
});

describe("markable", () => {
  test("keeps ranges that touch few of a line's words", () => {
    // arrange
    const ranges = [{ start: 6, end: 13 }];

    // act
    // assert
    expect(markable("const newPath = 1;", ranges, 0.7)).toEqual(ranges);
  });

  test("drops ranges that touch most of a line's words", () => {
    // arrange
    const ranges = [{ start: 0, end: 17 }];

    // act
    // assert: four of the five words changed, and only `;` did not.
    expect(markable("const newPath = 1;", ranges, 0.7)).toEqual([]);
  });

  test("keeps the same ranges under a higher limit", () => {
    // arrange
    const ranges = [{ start: 0, end: 17 }];

    // act
    // assert
    expect(markable("const newPath = 1;", ranges, 0.9)).toEqual(ranges);
  });
});
```

## Side by side

`splitRows` rearranges lines already drawn into two columns, so colours,
changed words, and hidden lines carry over. Context fills both columns
unless it has no `beforeLine`. Removed and added runs pair as
[changed words](#changed-words) pairs them, leftovers beside an empty cell,
so the marked words are the ones that differ from the line beside them.
Hunk headers, notes, and gaps span both columns. It takes any line with a
`kind` so tests use plain objects.

```ts
//| id: frontend-model-split
//| file: src/frontend/model/split.ts
/** One row of a side-by-side diff: a line of the file in either column or
 *  both, or something else across the two. */
export type SplitRow<L> =
  | { kind: "pair"; before: L | null; after: L | null }
  | { kind: "across"; line: L };

/** `lines`, in the order a unified diff reads them, laid out in two
 *  columns. */
export function splitRows<
  L extends { kind: string; beforeLine?: number | null },
>(lines: L[]): SplitRow<L>[] {
  const rows: SplitRow<L>[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as L;
    if (line.kind === "context") {
      rows.push({
        kind: "pair",
        before: line.beforeLine === null ? null : line,
        after: line,
      });
      index++;
      continue;
    }
    if (line.kind !== "removed" && line.kind !== "added") {
      rows.push({ kind: "across", line });
      index++;
      continue;
    }

    const removed: L[] = [];
    while (lines[index]?.kind === "removed") removed.push(lines[index++] as L);
    const added: L[] = [];
    while (lines[index]?.kind === "added") added.push(lines[index++] as L);
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      rows.push({
        kind: "pair",
        before: removed[row] ?? null,
        after: added[row] ?? null,
      });
    }
  }

  return rows;
}
```

### Test

```ts
//| id: frontend-model-split-test
//| file: src/frontend/model/split.test.ts
import { describe, expect, test } from "bun:test";
import { splitRows } from "./split";

const context = { kind: "context", code: "keep" };
const hunk = { kind: "hunk", text: "@@ -1,4 +1,3 @@" };
const note = { kind: "meta", text: "\\ No newline at end of file" };

function removed(code: string) {
  return { kind: "removed", code };
}

function added(code: string) {
  return { kind: "added", code };
}

describe("splitRows", () => {
  test("puts a context line in both columns", () => {
    expect(splitRows([context])).toEqual([
      { kind: "pair", before: context, after: context },
    ]);
  });

  test("puts a context line with no before side in the after column", () => {
    // arrange
    const moved = { kind: "context", code: "moved", beforeLine: null };

    // act
    const rows = splitRows([moved]);

    // assert
    expect(rows).toEqual([{ kind: "pair", before: null, after: moved }]);
  });

  test("pairs a removed run with the added run after it, row by row", () => {
    // arrange
    const lines = [removed("a"), removed("b"), added("A"), added("B")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: added("A") },
      { kind: "pair", before: removed("b"), after: added("B") },
    ]);
  });

  test("leaves the longer run's extra lines beside an empty cell", () => {
    // arrange
    const lines = [removed("a"), added("A"), added("B"), added("C")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: added("A") },
      { kind: "pair", before: null, after: added("B") },
      { kind: "pair", before: null, after: added("C") },
    ]);
  });

  test("draws a lone removal or addition on its own side", () => {
    // arrange
    const lines = [removed("a"), context, added("b")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "pair", before: removed("a"), after: null },
      { kind: "pair", before: context, after: context },
      { kind: "pair", before: null, after: added("b") },
    ]);
  });

  test("spans anything else across both columns, ending a run", () => {
    // arrange
    const lines = [hunk, removed("a"), note, added("a")];

    // act
    const rows = splitRows(lines);

    // assert
    expect(rows).toEqual([
      { kind: "across", line: hunk },
      { kind: "pair", before: removed("a"), after: null },
      { kind: "across", line: note },
      { kind: "pair", before: null, after: added("a") },
    ]);
  });
});
```

## Interdiff rows

`InterdiffRows` draws one section per pair, in graph order. A row with no
files says which nothing it is: two commits making the same change is what
someone checking a rebase wants to know, and an empty commit is something
else. A comment on the whole comparison sits between the header and the
files. All a review document adds to a row, from the bar's buttons to the
files' comments, comes out of `partsOf`, so a row checks for the document
once. Under the header is the after (else before) commit's
[`CommitMessage`](commit-message.md); a changed message already shows as the
`JJ-COMMIT-DESCRIPTION` file.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import { type ReactNode, useState } from "react";
import { type BeforePaths, compareOffer } from "../model/compared";
import type {
  DiffReview,
  ReviewActions,
  ReviewBarVariant,
  ReviewedRow,
} from "../model/review";
import type { Display } from "../model/settings";
import type { SourceLookup } from "../model/source";
import { CommentComposer, CommentThreads } from "./Comments";
import { CommitMessage } from "./CommitMessage";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView/DiffView";

export function InterdiffRows({
  rows,
  plain,
  sources,
  review,
  beforePaths,
  display,
}: {
  rows: ReviewedRow[];
  /** Whether these are commits' own diffs rather than an interdiff. */
  plain: boolean;
  sources: SourceLookup;
  beforePaths: BeforePaths;
  /** Null while there is no review document to change, which draws each
   *  row with nothing on it that would write one. */
  review: ReviewActions | null;
  display: Display;
}) {
  const [composing, setComposing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <div>
      {rows.map((row) => {
        const parts = partsOf(
          review,
          beforePaths,
          row,
          composing,
          setComposing,
        );
        return (
          <section
            key={rowKey(row)}
            id={rowAnchor(row)}
            className="interdiff-row"
          >
            <ComparisonHeader row={row} plain={plain} bar={parts.bar} />
            <CommitMessage
              description={(row.to ?? row.from)?.description ?? ""}
              className="interdiff-message"
              isExpanded={expanded.has(rowKey(row))}
              onExpand={() => toggleExpanded(rowKey(row))}
            />
            {parts.comments}
            {row.files.length === 0 ? (
              <p className="interdiff-empty">
                {row.from !== null && row.to !== null
                  ? "Both commits make the same change."
                  : "No changes in this commit."}
              </p>
            ) : (
              <DiffView
                files={row.files}
                sources={sources}
                scope={rowKey(row)}
                display={display}
                review={parts.diff}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** What a review document adds to a row that a row without one leaves out. */
interface RowParts {
  bar: ReviewBarVariant;
  /** The composer and threads on the whole comparison, under the message. */
  comments: ReactNode;
  diff: DiffReview | undefined;
}

function partsOf(
  review: ReviewActions | null,
  beforePaths: BeforePaths,
  row: ReviewedRow,
  composing: string | null,
  setComposing: (key: string | null) => void,
): RowParts {
  if (review === null) {
    return { bar: { kind: "read-only" }, comments: null, diff: undefined };
  }
  return {
    bar: {
      kind: "writable",
      onMarkSeen: () => review.markSeen(row),
      onComment: () => setComposing(rowKey(row)),
    },
    comments: (
      <>
        {composing === rowKey(row) && (
          <CommentComposer
            anchor={{ kind: "comparison" }}
            onCancel={() => setComposing(null)}
            onSubmit={(anchor, body) => {
              review.addComment(row, anchor, body);
              setComposing(null);
            }}
          />
        )}
        <CommentThreads
          comments={row.comments.filter(
            (comment) => comment.kind === "comparison",
          )}
          onEditComment={review.editComment}
          onResolveComment={review.resolveComment}
          onDropComment={review.dropComment}
          onReplyToComment={review.replyToComment}
          onEditReply={review.editReply}
          onDropReply={review.dropReply}
        />
      </>
    ),
    diff: {
      comments: row.comments,
      onAddComment: (anchor, body) => review.addComment(row, anchor, body),
      onEditComment: review.editComment,
      onResolveComment: review.resolveComment,
      onDropComment: review.dropComment,
      onReplyToComment: review.replyToComment,
      onEditReply: review.editReply,
      onDropReply: review.dropReply,
      viewed: row.viewed,
      onToggleViewed: (file) => review.toggleViewed(row, file),
      compare: compareOffer(row, beforePaths, review.compare),
    },
  };
}

/** Keyed on commit ids: a reorder can put one change id on two rows.
 *  Also the scope [`DiffView` anchors](file-tree.md#folding-a-diffs-files-into-a-tree)
 *  its files under, so two rows never collide on the same file's id. */
export function rowKey(row: ReviewedRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}

/** The id of a row's whole section, header and all, which the
 *  [file navigator](file-tree.md#stepping-through-files) jumps to when a
 *  reader picks a commit rather than a file. */
export function rowAnchor(row: ReviewedRow): string {
  return `row-${rowKey(row)}`;
}
```

```css
/*| id: design-interdiff-rows
@layer components {
  .interdiff-row {
    scroll-margin-top: var(--diff-sticky-top, 0px);
  }

  .interdiff-empty {
    padding: var(--space-5);
    font-style: italic;
    color: var(--text-muted);
  }

  .interdiff-message {
    max-width: 72ch;
    padding: var(--space-3) var(--space-5);
  }
}
```

The message is held to 72 columns, the width commit bodies are wrapped to,
until the pane is narrower anyway.

```css
/*| id: design-interdiff-rows
@layer components-narrow {
  @media (max-width: 1000px) {
    .interdiff-message {
      max-width: none;
    }
  }
}
```
## Comparison header

Each row's header names its before and after commits, or says one is
missing, since with independent pickers and several stacked rows nothing
else says what was compared. A plain diff's header is a single `commit` line.
Below sits the [review bar](review.md#the-review-bar).

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { LogEntry } from "../model/history";
import type { ReviewBarVariant, ReviewedRow } from "../model/review";
import { CommitLabel } from "./CommitLabel";
import { ReviewBar } from "./ReviewBar";

export function ComparisonHeader({
  row,
  plain,
  bar,
}: {
  row: ReviewedRow;
  /** A commit's own diff, which names the one commit and no sides. */
  plain: boolean;
  bar: ReviewBarVariant;
}) {
  return (
    <header className="comparison-header">
      {plain ? (
        <Row caption="commit" commit={row.to ?? row.from} />
      ) : (
        <>
          <Row caption="before" commit={row.from} />
          <Row caption="after" commit={row.to} />
        </>
      )}
      <ReviewBar
        review={row}
        files={row.files}
        commentLabel="comment on comparison"
        variant={bar}
      />
    </header>
  );
}

function Row({
  caption,
  commit,
}: {
  caption: string;
  commit: LogEntry | null;
}) {
  return (
    <div className="comparison-header__row">
      <span className="comparison-header__caption">{caption}</span>
      {commit === null ? (
        <em className="comparison-header__unavailable">not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}
```

The caption column is fixed-width so `before` and `after` line up. A tint
and a thick top rule set the header apart from the grey file headers, so a
new commit is not scrolled past unnoticed.

```css
/*| id: design-comparison-header
@layer components {
  .comparison-header {
    padding: var(--space-4) var(--space-5);
    background: var(--commit-header-surface);
    border-top: var(--border-width-accent) solid var(--commit-header-edge);
    border-bottom: 1px solid var(--border);
  }

  .comparison-header__row {
    display: flex;
    white-space: nowrap;
    overflow: hidden;
  }

  .comparison-header__caption {
    width: var(--label-width);
    flex: none;
    color: var(--text-faint);
  }

  .comparison-header__unavailable {
    font-style: italic;
    color: var(--text-ghost);
  }
}
```
