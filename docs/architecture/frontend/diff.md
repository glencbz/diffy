# Diff

What the panel shows once both sides have a selection, whether that is one
commit's diff or a whole series lined up as an interdiff.

## Choosing what to compare

`useComparison` owns the diff panel's contents. A `Comparison` is the question,
a pair of commit selections out of the local repo. A pull request is read
commit by commit on [its own screen](pull-requests.md#row-comparisons), which
asks the backend one row at a time and never comes through here.

An empty `from` array is the "nothing picked yet" state, which the backend
already answers by showing the after side's own diff. The hook reloads
whenever the question changes and drops a response that lands after it has
changed again. Both selections empty is the one question with no answer, so
the hook reports `null` without a request. A comparison is a fresh object
every render, so the effect depends on its JSON the same way `useCommits`
depends on a source's.

```tsx
//| id: frontend-state-comparison
//| file: src/frontend/state/comparison.ts
import { useEffect, useState } from "react";
import { fetchInterdiff, type InterdiffRow } from "../api";
import type { AsyncState } from "./asyncState";

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
    setState({ status: "loading" });
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

A comparison of local commits comes back as one row per lined-up pair, and
each row carries its own header saying which commit faced which.

It also loads [both sides of every file](syntax.md#loading-each-side) in the
comparison once it lands, for the diff to colour. That hook sits above the
early returns with an empty list to begin with, because hooks run on every
render or on none.

Takes a `session` prop rather than calling `useSession` itself, since `App`
owns the one session for the whole page and other readers will want it. The
existing null/loading/error branches on the comparison fetch are untouched,
because a synchronous local store adds nothing to them. `reviewRows` runs
below those early returns as a plain function call, since it derives from
props already in hand rather than fetching.

Once there is more than one file across every row, `DiffPane` also renders
a [`FileNavigator`](file-tree.md#stepping-through-files) above the rows,
built from the same `changedFilesOf` a `DiffView` uses and scoped by the
same `rowKey`, so the file the navigator names is always the file its
click lands on. A row's label is its commit's own subject line, read once
there is more than one row to tell apart; with one row, nothing needs
naming.

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx
import { type Comparison, useComparison } from "../state/comparison";
import { type ReviewedRow, reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { useSources } from "../state/source";
import { changedFilesOf } from "../views/changedFiles";
import { FileNavigator, type FileNavigatorGroup } from "../views/FileNavigator";
import { InterdiffRows, rowKey } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  session,
}: {
  comparison: Comparison;
  session: Session;
}) {
  const answer = useComparison(comparison);
  const sources = useSources(
    answer?.status === "ready" ? answer.data.flatMap((row) => row.files) : [],
  );

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }

  const rows = reviewRows(answer.data, session.document);
  const groups: FileNavigatorGroup[] = rows.map((row) => ({
    label: rows.length > 1 ? rowLabel(row) : null,
    files: changedFilesOf(row.files, rowKey(row), row.comments),
  }));
  const total = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <>
      {total >= 2 && <FileNavigator groups={groups} />}
      <InterdiffRows
        rows={rows}
        sources={sources}
        onMarkSeen={session.markSeen}
        onAddComment={session.addComment}
        onResolveComment={session.resolveComment}
        onDropComment={session.dropComment}
      />
    </>
  );
}

function rowLabel(row: ReviewedRow): string {
  const commit = row.to ?? row.from;
  if (commit === null) return "";
  const subject = commit.description.split("\n")[0];
  return subject !== undefined && subject !== ""
    ? subject
    : commit.commitId.slice(0, 8);
}
```

## Diff view

Renders each file's `git`-format patch, in colour. `+` lines sit on green and
`-` lines on red, `@@` hunk headers are blue, and file headers grey. The code
on each line is coloured by its language, taken from whichever side of the
file the line belongs to through the `sources` lookup a
[controller loads](syntax.md#loading-each-side). A binary file gets a
placeholder in place of a patch body. The caller always
hands it a real `files` array. The controller deals with anything that is not
a rendered diff.

The patch is not drawn as text. [`readPatch`](#reading-a-patch) reads it into
a header and hunks first, and every drawn line comes from a hunk line that
already knows its kind and its line numbers. A removed line is looked up on the
before side by its old number, and every other line on the after side by its
new one. The lookup is checked against the patch: when the highlighted line
does not read the same as the patch's, or its side has not loaded, the line is
drawn as one plain token. A patch is always right about its own text, so a
side that disagrees with it loses its colours rather than changing what the
reader sees. `sources` is optional for the same reason, and a diff without it
reads exactly as it would have with every side still loading.

Around each hunk, a row stands in for the unchanged lines the patch
[left out](#hidden-lines), once the after side has loaded and says how long
the file is. Clicking it draws those lines from the after side as context,
numbered and commentable like any other. A hunk header only says where the
next hunk jumps to, so once the lines above it are drawn there is no jump and
the header goes. Which gaps are shown is `useState` in the file's own row,
since nothing outside that file cares.

A left gutter adds the after-side line number to each rendered line, because
that is what a comment's `line` field means: the line as it reads in the
version being approved, not an offset into the raw patch text. Header lines,
hunk headers, and git's `\ No newline at end of file` note never had an
after-side line, and a `-` line was removed, so it has none either. They show
a blank gutter and are not clickable, because there is nothing on that line in
the version a comment would be anchored to.

Clicking a commentable line opens a composer for it, a plain `<form>` with one
`useState<{path, line} | null>` for which line's composer is open, closed again
on submit or cancel. Comment threads render under the file's `<pre>` rather
than in the gutter. A gutter-anchored thread would have to reflow around
variable-height content on every keystroke, and the patch is already read top
to bottom, so a comment reads as the next thing under the line it is about. A
thread whose `commitId` matches neither side of the row says it is stale in
place, because the line number next to it may no longer be the line the
comment was written about.

A file is drawn one of two ways. The structural view draws the hunks
[difftastic](../backend/difft.md) read out of the change, which ignore a
reformat and mark the tokens that changed rather than the words. The line
view draws the `git` patch. Both arrive with every file, so switching costs
no request. Each file has its own switch in its header. Until the reader
uses it, a file starts in the [default from Settings](settings.md#display),
read from `DiffModeDefault`. The context lives here, beside the one component
that reads it, and `App` provides the reader's choice through it. The switch is `useState` in the file's row, like its
hidden lines, so it lasts as long as the file is on screen.

The two views are the same drawing over different hunks. Difftastic's hunks
come in the shape a patch reads into, numbered the same way, so the gutter,
the composer, and hidden lines treat them exactly as they treat a patch's.
The only difference is where the changed ranges come from: difftastic names
them, and a patch's are [worked out here](#changed-words). A file difftastic
has nothing for, such as an added file or one too large to parse, is drawn
from its patch, and its switch says why the structural view is off.

Comments do not depend on the view. A comment is pinned to a line of the
after side, and both views number the after side's lines the same way, so a
comment left in one view names the same line in the other, and its thread
sits under the file in both. A line difftastic calls unchanged, such as one
a reformat moved, is context in the structural view, still numbered and
still commentable. Which lines are shown differs between the two views,
so gaps opened in one view are kept apart from gaps opened in the other.

The path in a file's header is a button that folds the file down to that
header, and opens it again. In a diff that links its files the path is a
link instead, and a link cannot sit inside a button, so the chevron and the
status in front of it are the button. A file that is mostly noise to a
reviewer [starts folded](#collapsed-files), with the reason next to its path,
unless a comment is already on it or the address names it, because a folded
file would hide the thread or the line a link was sent for.
Whether a file is open is `useState` in its row, like its view.

All of that hangs off one optional `DiffReview` rather than four optional
props, which could not be supplied half-filled. A diff either carries review
memory or it does not, and a diff without it offers no commentable line, so a
read-only diff cannot advertise an affordance that records nothing.

A diff of more than one file gets a [summary](file-tree.md) above its files:
a folded tree standing in for the files themselves, so a reader can see the
shape of the change before reading any of it. Every file's `<section>` also
carries an id, so the summary, and later a [navigator](file-tree.md) beside
it, can jump straight to a file rather than only describing where it is.
The id is scoped by the caller, one comparison row's key or one pull
request stack row's commit id, because the same path can appear once per
row and each occurrence needs a section of its own to jump to.

A diff whose place is kept in [the address](address.md) is handed
`DiffLinks`. A file's path in its header, and the gutter number of each of its
after-side lines, become links to that file and that line, and the file or
line the address names is marked with a bar down its left edge. A file is
named by its path in the version being read, the new one for a rename, since
that is the file a reader opening the link will find. The links are real
`<a href>`s, so one can be copied, or opened in a new tab, like any other, and
only a plain click is followed in place. Only the gutter is a link, not the
whole line, so selecting the text of a line still selects text. A line that
opens a composer when clicked is already a `<button>`, and a link cannot sit
inside one, so a diff with review memory draws no line links. No screen hands
a diff both today.

The marked file or line is scrolled to the middle of the pane when the diff
mounts and whenever `reveal` changes. It is not scrolled to when a click marks
it, since the reader is looking at what they clicked.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import {
  createContext,
  type MouseEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileDiff, SourceFile, StructuralDiff, SyntaxToken } from "../api";
import { DEFAULT_SETTINGS, type DiffMode } from "../model/settings";
import type { FileSpot } from "../state/place";
import type { RowComment } from "../state/review";
import type { SourceLookup } from "../state/source";
import {
  afterPathOf,
  type ChangedFile,
  changedFile,
  fileAnchor,
  fileTree,
  shownPathOf,
} from "./changedFiles";
import { collapseReason } from "./collapse";
import { FileTree } from "./FileTree";
import { gapsOf, type HunkLine, type Patch, readPatch } from "./patch";
import {
  changedLines,
  type PaintedToken,
  paintWords,
  type Range,
} from "./words";

/** The view a file's diff starts in until the reader switches that file. */
export const DiffModeDefault = createContext<DiffMode>(
  DEFAULT_SETTINGS.display.diffMode,
);

/** Review memory for the files on screen. A diff that has one lets every
 * after-side line be commented on; a diff that has none renders read-only. */
export interface DiffReview {
  comments: RowComment[];
  onAddComment: (path: string, line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}

/** Where the files and lines of a diff link to, for a diff whose place is
 *  kept in the address. */
export interface DiffLinks {
  /** The file or line the address names, when it is in this diff. */
  selected: FileSpot | null;
  href: (spot: FileSpot) => string;
  onFollow: (spot: FileSpot) => void;
}

export function DiffView({
  files,
  sources,
  review,
  scope,
  links,
  reveal,
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
}) {
  const [composer, setComposer] = useState<{
    path: string;
    line: number;
  } | null>(null);

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
            sides={sidesOf(file, sources)}
            links={links === undefined ? undefined : fileLinks(links, file)}
            reveal={reveal}
            review={
              review === undefined
                ? undefined
                : {
                    comments: review.comments.filter(
                      (comment) => comment.path === path,
                    ),
                    composerLine:
                      composer?.path === path ? composer.line : null,
                    onOpenComposer: (line) => setComposer({ path, line }),
                    onCancelComposer: () => setComposer(null),
                    onSubmitComposer: (line, body) => {
                      review.onAddComment(path, line, body);
                      setComposer(null);
                    },
                    onResolveComment: review.onResolveComment,
                    onDropComment: review.onDropComment,
                  }
            }
          />
        );
      })}
    </div>
  );
}

/** A table of contents for the files below, shown once there is more than
 *  one to summarise. Picking a row scrolls straight to that file's
 *  `<section>`, found by the same anchor id the section itself carries, so
 *  the summary needs no ref threaded down to reach it. */
function FileSummary({ files }: { files: ChangedFile[] }) {
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

/** `DiffReview` narrowed to one file, with the composer this view owns. */
interface FileReview {
  comments: RowComment[];
  composerLine: number | null;
  onOpenComposer: (line: number) => void;
  onCancelComposer: () => void;
  onSubmitComposer: (line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}

/** `DiffLinks` narrowed to one file. */
interface FileLinks {
  /** This file's place in the address, when the address names it. */
  selected: FileSpot | null;
  href: (line: number | null) => string;
  onFollow: (line: number | null) => void;
}

function fileLinks(links: DiffLinks, file: FileDiff): FileLinks {
  const path = afterPathOf(file);
  return {
    selected: links.selected?.path === path ? links.selected : null,
    href: (line) => links.href({ path, line }),
    onFollow: (line) => links.onFollow({ path, line }),
  };
}

/** A plain click on a link is followed in place. One asking for a new tab
 *  or window is left to the browser, which is what the `href` is for. */
function follow(event: MouseEvent, onFollow: () => void): void {
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

/** Each side of one file, whole, where it has loaded. */
interface FileSides {
  old: SourceFile | null;
  new: SourceFile | null;
}

function sidesOf(file: FileDiff, sources?: SourceLookup): FileSides {
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

function FileRow({
  file,
  anchor,
  sides,
  review,
  links,
  reveal,
}: {
  file: FileDiff;
  anchor: string;
  sides: FileSides;
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
  const defaultMode = useContext(DiffModeDefault);
  const [chosen, setChosen] = useState<DiffMode | null>(null);
  const [shownIn, setShownIn] = useState<Record<DiffMode, ReadonlySet<number>>>(
    { structural: new Set(), line: new Set() },
  );

  const structural =
    file.structural.kind === "structural" ? file.structural : null;
  const mode = structural === null ? "line" : (chosen ?? defaultMode);
  const body =
    structural !== null && mode === "structural"
      ? structuralBody(structural)
      : patchBody(file.patch);
  const shown = shownIn[mode];
  const reason = collapseReason(file);
  const [opened, setOpened] = useState<boolean | null>(null);
  const open =
    opened ??
    (reason === null || (review?.comments.length ?? 0) > 0 || isSelected);

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
      </header>
      {!open ? null : file.binary ? (
        <p className="diff-file__binary">Binary file, no textual diff.</p>
      ) : (
        <pre className="diff-file__patch">
          {drawnLines(body, sides, shown).map((line, index) =>
            line.kind === "gap" ? (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
                key={index}
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
                  show {line.count} unchanged{" "}
                  {line.count === 1 ? "line" : "lines"}
                </span>
              </button>
            ) : (
              <PatchLine
                // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
                key={index}
                line={line}
                onOpenComposer={review?.onOpenComposer}
                links={links}
              />
            ),
          )}
        </pre>
      )}
      {open && review !== undefined && review.composerLine !== null && (
        <CommentComposer
          line={review.composerLine}
          onCancel={review.onCancelComposer}
          onSubmit={review.onSubmitComposer}
        />
      )}
      {open && review !== undefined && review.comments.length > 0 && (
        <div>
          {review.comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              onResolve={(resolved) =>
                review.onResolveComment(comment.id, resolved)
              }
              onDrop={() => review.onDropComment(comment.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const DIFF_MODES: { value: DiffMode; caption: string }[] = [
  { value: "structural", caption: "structural" },
  { value: "line", caption: "lines" },
];

/** Which view one file is drawn in. The structural button is off, with the
 *  reason as its title, when difftastic has nothing for the file. */
function DiffModeSwitch({
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

function CommentComposer({
  line,
  onCancel,
  onSubmit,
}: {
  line: number;
  onCancel: () => void;
  onSubmit: (line: number, body: string) => void;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSubmit(line, body);
      }}
    >
      <div className="comment-composer__line">line {line}</div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="comment-composer__input"
      />
      <div className="comment-composer__actions">
        <button type="submit">comment</button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

function CommentThread({
  comment,
  onResolve,
  onDrop,
}: {
  comment: RowComment;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={
        comment.resolved
          ? "comment-thread comment-thread--resolved"
          : "comment-thread"
      }
    >
      <div className="comment-thread__meta">
        <span>
          {comment.path}:{comment.line} ·{" "}
          {comment.resolved ? "resolved" : "open"}
        </span>
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        <button type="button" onClick={onDrop}>
          delete
        </button>
      </div>
      <div>{comment.body}</div>
      {comment.stale && (
        <div className="comment-thread__stale">
          written against {comment.commitId.slice(0, 8)}. That line has since
          been rewritten.
        </div>
      )}
    </div>
  );
}

/** A `<button>` when the line has an after-side line to comment on, a `<div>`
 *  otherwise. A read-only diff passes no `onOpenComposer`, which makes every
 *  line static, and a read-only diff with `links` makes the gutter number of
 *  every after-side line a link to it. */
function PatchLine({
  line,
  onOpenComposer,
  links,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
  onOpenComposer?: (line: number) => void;
  links?: FileLinks;
}) {
  const afterLine = "afterLine" in line ? line.afterLine : null;
  const linked =
    afterLine !== null && links !== undefined && onOpenComposer === undefined;
  const body = (
    <>
      {linked ? (
        <a
          href={links.href(afterLine)}
          onClick={(event) => follow(event, () => links.onFollow(afterLine))}
          className="diff-line__gutter diff-line__anchor"
        >
          {afterLine}
        </a>
      ) : (
        <span className="diff-line__gutter">{afterLine ?? ""}</span>
      )}
      {"text" in line ? (
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
      )}
    </>
  );
  const selected =
    afterLine !== null && links?.selected?.line === afterLine
      ? " diff-line--selected"
      : "";
  const className = `diff-line diff-line--${line.kind}${selected}`;

  if (afterLine === null || onOpenComposer === undefined) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(afterLine)}
      className={`${className} diff-line--interactive`}
    >
      {body}
    </button>
  );
}

function tokenClass(token: PaintedToken): string | undefined {
  const classes = [
    token.kind === null ? null : `syntax--${token.kind}`,
    token.changed ? "diff-line__changed" : null,
  ].filter((name) => name !== null);
  return classes.length === 0 ? undefined : classes.join(" ");
}

type CodeKind = "context" | "added" | "removed";

const SIGNS: Record<CodeKind, string> = {
  context: " ",
  added: "+",
  removed: "-",
};

/** One line as drawn. Header lines, hunk headers, and notes are text in one
 *  colour. A line of the file is its tokens, and its after-side line number
 *  where it has one. A gap stands in for the lines `gapsOf` numbered `gap`
 *  until it is shown. */
type DrawnLine =
  | { kind: "meta" | "hunk"; text: string }
  | { kind: "gap"; gap: number; count: number }
  | {
      kind: CodeKind;
      tokens: PaintedToken[];
      afterLine: number | null;
    };

/** What a file's lines are drawn from: hunks, and each hunk's changed
 *  ranges by line index. */
interface Body {
  patch: Patch;
  changed: Map<number, Range[]>[];
}

function patchBody(text: string): Body {
  const patch = readPatch(text);
  return {
    patch,
    changed: patch.hunks.map((hunk) => changedLines(hunk.lines)),
  };
}

/** Difftastic's hunks, with a note in place of them when it found the
 *  change was only layout. */
function structuralBody(
  diff: Extract<StructuralDiff, { kind: "structural" }>,
): Body {
  return {
    patch: {
      header:
        diff.hunks.length === 0
          ? ["No syntactic change. The line view shows the layout edits."]
          : [],
      hunks: diff.hunks,
    },
    changed: diff.hunks.map(
      (hunk) =>
        new Map(
          hunk.lines.flatMap((line, index) =>
            line.kind === "context" ? [] : [[index, line.changes]],
          ),
        ),
    ),
  };
}

function drawnLines(
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
      afterLine: gap.start + offset,
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
        afterLine: line.newLine,
      };
    case "added":
      return {
        kind: "added",
        tokens: paintWords(
          tokensAt(sides.new, line.newLine, line.code),
          changed,
        ),
        afterLine: line.newLine,
      };
    case "removed":
      return {
        kind: "removed",
        tokens: paintWords(
          tokensAt(sides.old, line.oldLine, line.code),
          changed,
        ),
        afterLine: null,
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

A patch line's kind is one of the fixed set a unified diff always has, so
each drawn line carries it as a modifier class instead of a lookup table of
colours. Header lines and hunk headers are coloured text. An added or removed
line is tinted behind its text and only its sign takes the line's colour,
because the text is [coloured by its syntax](syntax.md#colours) and green or
red text would drown that out. [Changed words](#changed-words) take a stronger
tint of the same colour.

A file's header sticks to the top of the scrolling pane while its file is
on screen, and the next file's header pushes it off. A long file otherwise
scrolls away the only place that says which file it is and the switch
between structural and line diffs, and on a phone a file runs for
screens. It sticks at `--diff-sticky-top`, the offset a jump to a file
already stops at: zero, unless
[the file navigator](file-tree.md#stepping-through-files) holds the top of
the pane.

The path takes whatever width the switch leaves and wraps anywhere,
because a path is one long word to a line breaker, and a word that cannot
shrink pushes the switch past the header's edge on a phone.

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
    align-items: baseline;
    padding: var(--space-2) var(--space-4);
    font-weight: bold;
    background: var(--surface-raised);
  }

  .diff-file__path {
    flex: 1;
    min-width: 0;
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

  .diff-file__status {
    margin-right: var(--space-4);
    color: var(--text-muted);
  }

  .diff-file__toggle {
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

A patch line spans the pane even when its text ends early, so a selected line
carries its background all the way to the right edge. `width: 100%` says that
while the pane is the wider of the two, and truncates the line to the pane as
soon as it is not, which on a phone is most lines. `max-content` with a `100%`
floor says the same thing at both sizes: as wide as the text, or as wide as
the pane, whichever is more. The sideways scroll `.diff-file__patch` already
has then reaches the rest.

```css
/*| id: design-diff-view
@layer components-narrow {
  @media (max-width: 1000px) {
    .diff-line {
      width: max-content;
      min-width: 100%;
    }
  }
}
```

## Collapsed files

`collapseReason` says why a file should start folded, as the words its
header shows, or `null` for a file that starts open. It looks at the file's
path and its patch, which are all the frontend has before anything else
loads, so the answer is ready on the first render and a file never folds
itself shut under the reader once a side arrives.

A lock file is known by its name. Its diff is a package manager's output,
and a reviewer checks the manifest change that caused it rather than the
resolved graph. A name ending in `.lock` counts too, which is the
convention most tools that are not in the list follow.

A generated file is known either by a path that only build tools write, or
by the marker a generator leaves at its top: `@generated`, or Go's
`Code generated ... DO NOT EDIT.`. The marker is only looked for on the
first few lines of the after side, and only where the patch shows them,
because a file that merely mentions the marker further down, like this
module, is not generated. An added file's patch is the whole file, so a
new generated file is always caught. A modified one is caught only when
its change is close enough to the top for the patch's context to carry
the marker.

A large diff is one whose patch adds and removes more lines than a reader
takes in at once. The limit counts changed lines in the `git` patch, not
the file's length, since a long file with a one-line change reads quickly.

```ts
//| id: frontend-view-collapse
//| file: src/frontend/views/collapse.ts
import type { FileDiff } from "../api";
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
//| id: frontend-view-collapse-test
//| file: src/frontend/views/collapse.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import { collapseReason, LARGE_DIFF } from "./collapse";

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

## Reading a patch

`readPatch` turns one file's patch into the lines above its first hunk and
the hunks themselves. Each hunk line carries the line number it has on each
side the view reads it from, counted from its `@@ -a,b +c,d @@` header. A
removed line is read from the before side and every other line from the
after side, so a removed line carries its before-side number and the rest
their after-side one. The union says so, which leaves no line whose missing
number a reader has to guess the meaning of. A context line is on both sides
of a patch, but its before-side number is left off, because nothing draws
it, and a [structural diff](../backend/difft.md#from-chunks-to-hunks) has
context lines that have no before side at all.

git's `\ No newline at end of file` is a note about the line above it rather
than a line of the file, so it is a kind of its own, with no numbers and no
prefix to strip. The patch's trailing newline would otherwise read as one more
empty line at the bottom of the last hunk, so it is dropped before reading.

```ts
//| id: frontend-view-patch
//| file: src/frontend/views/patch.ts
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
  lines: HunkLine[];
}

/** A line inside a hunk. `code` is the line without its `+`, `-`, or space,
 *  and line numbers count from 1, as each side's file has them. */
export type HunkLine =
  | { kind: "context"; code: string; newLine: number }
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
      hunks.push({ header: text, newStart: newLine, lines: [] });
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
      oldLine++;
      hunk.lines.push({ kind: "context", code, newLine: newLine++ });
    }
  }

  return { header, hunks };
}
```

### Test

```ts
//| id: frontend-view-patch-test
//| file: src/frontend/views/patch.test.ts
import { describe, expect, test } from "bun:test";
import { gapsOf, readPatch } from "./patch";

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
        lines: [
          { kind: "context", code: "keep", newLine: 10 },
          { kind: "removed", code: "old", oldLine: 11 },
          { kind: "added", code: "new", newLine: 11 },
          { kind: "context", code: "keep", newLine: 12 },
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
      { kind: "context", code: "b", newLine: 2 },
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
```

### Hidden lines

A patch keeps three lines of context around each change and leaves the rest
of the file out. `gapsOf` names what it left out, on the after side: the
lines before each hunk that the hunk above it did not show, and the lines
after the last hunk, down to the end of the file. The after side is enough
because a hidden line is unchanged, so it reads the same on both sides, and
the after side is the one a comment is anchored to.

A gap is only known once the length of the after side is, which is when its
source has loaded. A side whose length falls short of what the hunks
already show says nothing true about what lies between them, so a gap is
never negative, only empty.

```ts
//| id: frontend-view-patch

/** Unchanged after-side lines the patch left out, `count` of them from line
 *  `start` on. */
export interface Gap {
  start: number;
  count: number;
}

/** One gap before each hunk and one after the last, empty where the hunks
 *  already meet or reach the end, for an after side `length` lines long. */
export function gapsOf(patch: Patch, length: number): Gap[] {
  const gaps: Gap[] = [];
  let next = 1;

  for (const hunk of patch.hunks) {
    gaps.push({ start: next, count: Math.max(0, hunk.newStart - next) });
    next =
      hunk.newStart + hunk.lines.filter((line) => "newLine" in line).length;
  }
  gaps.push({ start: next, count: Math.max(0, length - next + 1) });

  return gaps;
}
```

```ts
//| id: frontend-view-patch-test

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
      { start: 1, count: 3 },
      { start: 6, count: 14 },
      { start: 22, count: 9 },
    ]);
  });

  test("resumes after a hunk that only removes", () => {
    // arrange
    const patch = readPatch(["@@ -5,2 +4,0 @@", "-a", "-b"].join("\n"));

    // act
    const gaps = gapsOf(patch, 10);

    // assert
    expect(gaps).toEqual([
      { start: 1, count: 4 },
      { start: 5, count: 6 },
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

A line that was edited rather than replaced comes back as a removed line and
an added line that are mostly the same. Reading which few characters differ
between the two is the reader's job unless something marks them, so the
words that changed are drawn on a stronger tint than the rest of their line.

`changedLines` pairs lines up the way a patch lays an edit out: a run of
removed lines followed straight away by a run of added ones is an edit of
those lines, and the first removed line is paired with the first added line,
the second with the second, and so on. Lines left over on either side were
purely removed or added and have nothing to be compared against.

`changedWords` compares one pair a word at a time, where a word is a run of
letters and digits, a run of whitespace, or a single other character, and
answers the character ranges on each side that are not in their longest
common subsequence. Comparing whole words keeps `oldPath` against `newPath`
one change rather than a scatter of changed letters. Two lines that share less
than `MIN_SHARED` of their text were rewritten rather than edited, and marking
nearly everything in both says less than marking nothing, so such a pair gets
no ranges. A pair too long to compare in reasonable time, past `MAX_CELLS`
cells of the comparison table, gets none either.

`paintWords` cuts a line's syntax tokens at those ranges so the marks and the
colours can be drawn together, each piece keeping its token's kind.

```ts
//| id: frontend-view-words
//| file: src/frontend/views/words.ts
import type { SyntaxKind, SyntaxToken } from "../api";
import type { HunkLine } from "./patch";

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
```

### Test

```ts
//| id: frontend-view-words-test
//| file: src/frontend/views/words.test.ts
import { describe, expect, test } from "bun:test";
import type { HunkLine } from "./patch";
import { changedLines, changedWords, paintWords } from "./words";

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
```

## Interdiff rows

One section per lined-up pair, in the order the backend sent them, which is the
order of the graphs that fed it. Each section is its own header and its own
patch, so a reader scrolls the comparison the way they scroll a branch.

A row with no files still renders, and says which kind of nothing it is. Two
commits that make the same change is the answer someone checking a rebase
wants; an empty commit on its own says something else. That branch lives here
rather than in the controller, because it is per row and the controller sees
the list.

Rows take `ReviewedRow` now, not the bare wire `InterdiffRow`, and thread the
four session callbacks down to `ComparisonHeader` and `DiffView`. `rowKey`
stays keyed on commit ids as before. [A reordered series can put the same
change id on two rows](review-tracking.md#review-state), so the change id is
not a unique React key even though it now sits on the row.

```tsx
//| id: frontend-view-interdiff-rows
//| file: src/frontend/views/InterdiffRows.tsx
import type { ReviewedRow } from "../state/review";
import type { SourceLookup } from "../state/source";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  sources,
  onMarkSeen,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  rows: ReviewedRow[];
  sources: SourceLookup;
  onMarkSeen: (row: ReviewedRow) => void;
  onAddComment: (
    row: ReviewedRow,
    path: string,
    line: number,
    body: string,
  ) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader row={row} onMarkSeen={() => onMarkSeen(row)} />
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
              review={{
                comments: row.comments,
                onAddComment: (path, line, body) =>
                  onAddComment(row, path, line, body),
                onResolveComment,
                onDropComment,
              }}
            />
          )}
        </section>
      ))}
    </div>
  );
}

/** Also the scope [`DiffView` anchors](file-tree.md#folding-a-diffs-files-into-a-tree)
 *  its files under, so two rows never collide on the same file's id. */
export function rowKey(row: ReviewedRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}
```

A comparison with no files still renders, and the placeholder saying so
gets the same muted italic treatment every empty state in the app uses.

```css
/*| id: design-interdiff-rows
@layer components {
  .interdiff-empty {
    padding: var(--space-5);
    font-style: italic;
    color: var(--text-muted);
  }
}
```
## Comparison header

Every row says what it is showing before it shows it: which commit is the
before side, which is the after side, and when one of them is missing. Without
it a row is an unlabelled patch, and with two independent operation pickers on
screen and several rows stacked up, there is no way to work back to what was
compared.

A third line adds review state to that same job: whether the row has been
looked at, whether it moved since, and how many open comments sit on it. The
`mark seen` / `mark unseen` button reads its own label off
`row.review.state`, so the caller wires the click through without computing
which action is current.

```tsx
//| id: frontend-view-comparison-header
//| file: src/frontend/views/ComparisonHeader.tsx
import type { ReactNode } from "react";
import type { LogEntry } from "../api";
import type { ReviewedRow, RowReview } from "../state/review";
import { CommitLabel } from "./CommitLabel";

export function ComparisonHeader({
  row,
  onMarkSeen,
}: {
  row: ReviewedRow;
  onMarkSeen: () => void;
}) {
  const openComments = row.comments.filter(
    (comment) => !comment.resolved,
  ).length;

  return (
    <header className="comparison-header">
      <Row caption="before" commit={row.from} />
      <Row caption="after" commit={row.to} />
      <div className="comparison-header__actions">
        <ReviewChip review={row.review} />
        {openComments > 0 && <Chip tone="open">{openComments} open</Chip>}
        <button
          type="button"
          onClick={onMarkSeen}
          className="comparison-header__mark-seen"
        >
          {row.review.state === "reviewed" ? "mark unseen" : "mark seen"}
        </button>
      </div>
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

function ReviewChip({ review }: { review: RowReview }) {
  if (review.state === "unseen") return null;
  return review.state === "reviewed" ? (
    <Chip tone="reviewed">reviewed</Chip>
  ) : (
    <Chip tone="changed">changed since you looked</Chip>
  );
}

const TONE_CLASS: Record<"reviewed" | "changed" | "open", string> = {
  reviewed: "review-chip--resolved",
  changed: "review-chip--stale",
  open: "review-chip--open",
};

function Chip({
  tone,
  children,
}: {
  tone: "reviewed" | "changed" | "open";
  children: ReactNode;
}) {
  return <span className={`review-chip ${TONE_CLASS[tone]}`}>{children}</span>;
}
```

ComparisonHeader stacks the before and after rows over a strip of review
actions, and the caption column is a fixed width so "before" and "after"
line up with each other no matter how long the commit summary next to them
runs.

```css
/*| id: design-comparison-header
@layer components {
  .comparison-header {
    padding: var(--space-4) var(--space-5);
    background: var(--surface-sunken);
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

  .comparison-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .comparison-header__mark-seen {
    font: inherit;
  }
}
```
