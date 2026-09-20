# Diff

What the panel shows once both sides have a selection, whether that is one
commit's diff or a whole series lined up as an interdiff.

## Choosing what to compare

`useComparison` owns the diff panel's contents. A `Comparison` is the question,
and it has one arm per screen: a pair of commit selections out of the local
repo, or a pair of heads of one pull request.

Only the jj arm has a "nothing picked yet" state, an empty `from` array,
which the backend already answers by showing the after side's own diff. The
pull arm has no such state. Its after end is a head and its before end is a
`PullBaseline`, both required, and the controller always has a value for each
to fall back on, the pull request's first head.

The hook reloads whenever the question changes and drops a response that lands
after it has changed again. Both jj selections empty is the one question with
no answer, so the hook reports `null` without a request. A comparison is a
fresh object every render, so the effect depends on its JSON the same way
`useCommits` depends on a source's.

```tsx
//| id: frontend-state-comparison
//| file: src/frontend/state/comparison.ts
import { useEffect, useState } from "react";
import {
  type FileDiff,
  fetchInterdiff,
  fetchPullDiff,
  type GitOid,
  type InterdiffRow,
  type PullBaseline,
} from "../api";
import type { AsyncState } from "./asyncState";

/** What the diff panel is being asked for. */
export type Comparison =
  | { kind: "jj"; from: string[]; to: string[] }
  | {
      kind: "pull";
      repo: string;
      number: number;
      /** What the after side is measured against, a head or the base branch. */
      from: PullBaseline;
      to: GitOid;
    };

/** The answer, shaped by what was asked. */
export type ComparisonFiles =
  | { kind: "jj"; rows: InterdiffRow[] }
  | { kind: "pull"; files: FileDiff[] };

async function compare(question: Comparison): Promise<ComparisonFiles> {
  if (question.kind === "jj") {
    const { rows } = await fetchInterdiff(question.from, question.to);
    return { kind: "jj", rows };
  }

  const { files } = await fetchPullDiff(
    question.repo,
    question.number,
    question.to,
    question.from,
  );
  return { kind: "pull", files };
}

function hasNothingToAsk(question: Comparison): boolean {
  return (
    question.kind === "jj" &&
    question.from.length === 0 &&
    question.to.length === 0
  );
}

export function useComparison(
  question: Comparison,
): AsyncState<ComparisonFiles> | null {
  const [state, setState] = useState<AsyncState<ComparisonFiles> | null>(null);
  const key = hasNothingToAsk(question) ? "" : JSON.stringify(question);

  useEffect(() => {
    if (key === "") {
      setState(null);
      return;
    }

    let live = true;
    setState({ status: "loading" });
    compare(JSON.parse(key) as Comparison)
      .then((data) => {
        if (live) setState({ status: "ready", data });
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

The diff panel's contents follow from what was asked. A comparison of local
commits comes back as one row per lined-up pair, and each row needs its own
header saying which commit faced which. A comparison of pull request heads
comes back as one patch, and the two versions it compares are already named on
the timeline above it, so a second header there would be a repetition.

Choosing between the two shapes happens here and nowhere else, which is what
keeps `DiffView` at "render these files".

Takes a `session` prop rather than calling `useSession` itself, since `App`
owns the one session for the whole page and other readers will want it. The
existing null/loading/error branches on the comparison fetch are untouched,
because a synchronous local store adds nothing to them. `reviewRows` runs
below those early returns as a plain function call, since it derives from
props already in hand rather than fetching.

Review memory reaches the jj branch alone. A mark and a comment are keyed by
the pair of commits a row lines up, and a pull request diff is one patch
between two heads with no such row, so it renders read-only until it is given
an identity of its own. Inventing one here would ship it untested behind a
conflict resolution.

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx
import { type Comparison, useComparison } from "../state/comparison";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { DiffView } from "../views/DiffView";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  session,
}: {
  comparison: Comparison;
  session: Session;
}) {
  const answer = useComparison(comparison);

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }
  if (answer.data.kind === "jj") {
    return (
      <InterdiffRows
        rows={reviewRows(answer.data.rows, session.document)}
        onMarkSeen={session.markSeen}
        onAddComment={session.addComment}
        onResolveComment={session.resolveComment}
        onDropComment={session.dropComment}
      />
    );
  }
  if (answer.data.files.length === 0) {
    return <Message>These two versions make the same change.</Message>;
  }

  return <DiffView files={answer.data.files} />;
}
```

## Diff view

Renders each file's verbatim `git`-format patch. The one thing it adds is
color. `+` lines green, `-` lines red, `@@` hunk headers blue, file headers
grey. A binary file gets a placeholder in place of a patch body. The caller
always hands it a real `files` array. The controller deals with anything that
is not a rendered diff.

A left gutter adds the after-side line number to each rendered line, because
that is what a comment's `line` field means: the line as it reads in the
version being approved, not an offset into the raw patch text. `gutterLines`
walks the patch once and carries a running counter, seeded by each `@@
-a,b +c,d @@` header's `c`. `diff --git`, `index `, `---`, `+++`, and hunk
header lines never had an after-side line, and a `-` line was removed, so it
has none either. Both show a blank gutter and are not clickable, because there
is nothing on that line in the version a comment would be anchored to.

Clicking a commentable line opens a composer for it, a plain `<form>` with one
`useState<{path, line} | null>` for which line's composer is open, closed again
on submit or cancel. Comment threads render under the file's `<pre>` rather
than in the gutter. A gutter-anchored thread would have to reflow around
variable-height content on every keystroke, and the patch is already read top
to bottom, so a comment reads as the next thing under the line it is about. A
thread whose `commitId` matches neither side of the row says it is stale in
place, because the line number next to it may no longer be the line the
comment was written about.

All of that hangs off one optional `DiffReview` rather than four optional
props, which could not be supplied half-filled. A diff either carries review
memory or it does not, and a diff without it offers no commentable line, so a
read-only diff cannot advertise an affordance that records nothing.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import { useState } from "react";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";

/** Review memory for the files on screen. A diff that has one lets every
 * after-side line be commented on; a diff that has none renders read-only. */
export interface DiffReview {
  comments: RowComment[];
  onAddComment: (path: string, line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}

export function DiffView({
  files,
  review,
}: {
  files: FileDiff[];
  review?: DiffReview;
}) {
  const [composer, setComposer] = useState<{
    path: string;
    line: number;
  } | null>(null);

  return (
    <div className="diff-view">
      {files.map((file) => {
        const path = pathOf(file);
        return (
          <FileRow
            key={path}
            file={file}
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

function FileRow({ file, review }: { file: FileDiff; review?: FileReview }) {
  return (
    <section className="diff-file">
      <header className="diff-file__header">
        <span className="diff-file__status">{file.status}</span>
        {pathOf(file)}
      </header>
      {file.binary ? (
        <p className="diff-file__binary">Binary file, no textual diff.</p>
      ) : (
        <pre className="diff-file__patch">
          {gutterLines(file.patch).map(({ text, afterLine }, index) => (
            <PatchLine
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
              key={index}
              text={text}
              afterLine={afterLine}
              onOpenComposer={review?.onOpenComposer}
            />
          ))}
        </pre>
      )}
      {review !== undefined && review.composerLine !== null && (
        <CommentComposer
          line={review.composerLine}
          onCancel={review.onCancelComposer}
          onSubmit={review.onSubmitComposer}
        />
      )}
      {review !== undefined && review.comments.length > 0 && (
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
 *  line static. */
function PatchLine({
  text,
  afterLine,
  onOpenComposer,
}: {
  text: string;
  afterLine: number | null;
  onOpenComposer?: (line: number) => void;
}) {
  const kind = lineKind(text);
  const body = (
    <>
      <span className="diff-line__gutter">{afterLine ?? ""}</span>
      <span className={kind === null ? undefined : `diff-line__text--${kind}`}>
        {text === "" ? " " : text}
      </span>
    </>
  );

  if (afterLine === null || onOpenComposer === undefined) {
    return <div className="diff-line">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(afterLine)}
      className="diff-line diff-line--interactive"
    >
      {body}
    </button>
  );
}

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

type DiffLineKind = "meta" | "hunk" | "added" | "removed";

function lineKind(line: string): DiffLineKind | null {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "meta";
  if (line.startsWith("diff --git ") || line.startsWith("index "))
    return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return null;
}

interface GutterLine {
  text: string;
  afterLine: number | null;
}

/** After-side line number per rendered patch line, or null where none applies. */
function gutterLines(patch: string): GutterLine[] {
  let afterLine: number | null = null;

  return patch.split("\n").map((text) => {
    if (
      text === "" ||
      text.startsWith("diff --git ") ||
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { text, afterLine: null };
    }

    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      afterLine = Number(hunk[1]);
      return { text, afterLine: null };
    }

    if (text.startsWith("-")) return { text, afterLine: null };

    if (afterLine === null) return { text, afterLine: null };
    const line = afterLine;
    afterLine += 1;
    return { text, afterLine: line };
  });
}
```

A patch line's colour is chosen from the same fixed set a unified diff
always has — added, removed, a hunk header, or file-level meta — so DiffView
maps a line's text to one of four modifier classes instead of a lookup
table of colours, and `--diff-added`, `--diff-removed`, `--diff-hunk`, and
`--diff-meta` are the only place those colours live.

```css
/*| id: design-diff-view
@layer components {
  .diff-view {
    padding: var(--space-5);
  }

  .diff-file {
    margin-bottom: var(--space-6);
    border: 1px solid var(--border);
  }

  .diff-file__header {
    padding: var(--space-2) var(--space-4);
    font-weight: bold;
    background: var(--surface-raised);
  }

  .diff-file__status {
    margin-right: var(--space-4);
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

  .diff-line__gutter {
    width: var(--gutter-width);
    flex: none;
    margin-right: var(--space-4);
    text-align: right;
    color: var(--text-ghost);
    user-select: none;
  }

  .diff-line__text--meta {
    color: var(--diff-meta);
  }

  .diff-line__text--hunk {
    color: var(--diff-hunk);
  }

  .diff-line__text--added {
    color: var(--diff-added);
  }

  .diff-line__text--removed {
    color: var(--diff-removed);
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
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({
  rows,
  onMarkSeen,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  rows: ReviewedRow[];
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

function rowKey(row: ReviewedRow): string {
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
