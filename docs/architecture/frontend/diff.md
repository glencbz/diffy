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

```tsx
//| id: frontend-controller-diff-pane
//| file: src/frontend/controllers/DiffPane.tsx
import { type Comparison, useComparison } from "../state/comparison";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { useSources } from "../state/source";
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

  return (
    <InterdiffRows
      rows={reviewRows(answer.data, session.document)}
      sources={sources}
      onMarkSeen={session.markSeen}
      onAddComment={session.addComment}
      onResolveComment={session.resolveComment}
      onDropComment={session.dropComment}
    />
  );
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

All of that hangs off one optional `DiffReview` rather than four optional
props, which could not be supplied half-filled. A diff either carries review
memory or it does not, and a diff without it offers no commentable line, so a
read-only diff cannot advertise an affordance that records nothing.

```tsx
//| id: frontend-view-diff
//| file: src/frontend/views/DiffView.tsx
import { useState } from "react";
import type { FileDiff, SourceFile, SyntaxToken } from "../api";
import type { RowComment } from "../state/review";
import type { SourceLookup } from "../state/source";
import { type HunkLine, type Patch, readPatch } from "./patch";

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
  sources,
  review,
}: {
  files: FileDiff[];
  sources?: SourceLookup;
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
            sides={sidesOf(file, sources)}
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
  sides,
  review,
}: {
  file: FileDiff;
  sides: FileSides;
  review?: FileReview;
}) {
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
          {drawnLines(readPatch(file.patch), sides).map((line, index) => (
            <PatchLine
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
              key={index}
              line={line}
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
  line,
  onOpenComposer,
}: {
  line: DrawnLine;
  onOpenComposer?: (line: number) => void;
}) {
  const afterLine = "afterLine" in line ? line.afterLine : null;
  const body = (
    <>
      <span className="diff-line__gutter">{afterLine ?? ""}</span>
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
              className={
                token.kind === null ? undefined : `syntax--${token.kind}`
              }
            >
              {token.text}
            </span>
          ))}
        </span>
      )}
    </>
  );
  const className = `diff-line diff-line--${line.kind}`;

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

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

type CodeKind = "context" | "added" | "removed";

const SIGNS: Record<CodeKind, string> = {
  context: " ",
  added: "+",
  removed: "-",
};

/** One line as drawn. Header lines, hunk headers, and notes are text in one
 *  colour. A line of the file is its tokens, and its after-side line number
 *  where it has one. */
type DrawnLine =
  | { kind: "meta" | "hunk"; text: string }
  | {
      kind: CodeKind;
      tokens: SyntaxToken[];
      afterLine: number | null;
    };

function drawnLines(patch: Patch, sides: FileSides): DrawnLine[] {
  return [
    ...patch.header.map((text): DrawnLine => ({ kind: "meta", text })),
    ...patch.hunks.flatMap((hunk) => [
      { kind: "hunk" as const, text: hunk.header },
      ...hunk.lines.map((line) => drawnHunkLine(line, sides)),
    ]),
  ];
}

function drawnHunkLine(line: HunkLine, sides: FileSides): DrawnLine {
  switch (line.kind) {
    case "context":
      return {
        kind: "context",
        tokens: tokensAt(sides.new, line.newLine, line.code),
        afterLine: line.newLine,
      };
    case "added":
      return {
        kind: "added",
        tokens: tokensAt(sides.new, line.newLine, line.code),
        afterLine: line.newLine,
      };
    case "removed":
      return {
        kind: "removed",
        tokens: tokensAt(sides.old, line.oldLine, line.code),
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
red text would drown that out.

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

  .diff-line--added {
    background: var(--diff-added-surface);
  }

  .diff-line--removed {
    background: var(--diff-removed-surface);
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

## Reading a patch

`readPatch` turns one file's patch into the lines above its first hunk and
the hunks themselves. Each hunk line carries the line number it has on each
side where it has one, counted from its `@@ -a,b +c,d @@` header. A context
line is on both sides, a removed line only on the before side, and an added
line only on the after side. The union says so, which leaves no line whose
missing number a reader has to guess the meaning of.

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
  lines: HunkLine[];
}

/** A line inside a hunk. `code` is the line without its `+`, `-`, or space,
 *  and line numbers count from 1, as each side's file has them. */
export type HunkLine =
  | { kind: "context"; code: string; oldLine: number; newLine: number }
  | { kind: "removed"; code: string; oldLine: number }
  | { kind: "added"; code: string; newLine: number }
  | { kind: "note"; text: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

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
      oldLine = Number(start[1]);
      newLine = Number(start[2]);
      hunks.push({ header: text, lines: [] });
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
        oldLine: oldLine++,
        newLine: newLine++,
      });
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
import { readPatch } from "./patch";

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
        lines: [
          { kind: "context", code: "keep", oldLine: 10, newLine: 10 },
          { kind: "removed", code: "old", oldLine: 11 },
          { kind: "added", code: "new", newLine: 11 },
          { kind: "context", code: "keep", oldLine: 12, newLine: 12 },
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
      { kind: "context", code: "b", oldLine: 2, newLine: 2 },
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
