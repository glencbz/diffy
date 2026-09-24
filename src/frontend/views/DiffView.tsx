// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff>>[init]
import { useContext, useMemo, useState } from "react";
import type { FileDiff, SourceFile, StructuralDiff, SyntaxToken } from "../api";
import type { RowComment } from "../state/review";
import { type DiffMode, DiffModeDefault } from "../state/settings";
import type { SourceLookup } from "../state/source";
import {
  afterPathOf,
  type ChangedFile,
  changedFile,
  fileAnchor,
  fileTree,
  shownPathOf,
} from "./changedFiles";
import { FileTree } from "./FileTree";
import { gapsOf, type HunkLine, type Patch, readPatch } from "./patch";
import {
  changedLines,
  type PaintedToken,
  paintWords,
  type Range,
} from "./words";

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
  scope,
}: {
  files: FileDiff[];
  sources?: SourceLookup;
  review?: DiffReview;
  /** Scopes this diff's file ids apart from any other diff on the page: a
   *  comparison row's key, or a pull request stack row's commit id. */
  scope: string;
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
}: {
  file: FileDiff;
  anchor: string;
  sides: FileSides;
  review?: FileReview;
}) {
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

  return (
    <section id={anchor} className="diff-file">
      <header className="diff-file__header">
        <span className="diff-file__status">{file.status}</span>
        {shownPathOf(file)}
        {!file.binary && (
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
      {file.binary ? (
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
              />
            ),
          )}
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
 *  line static. */
function PatchLine({
  line,
  onOpenComposer,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
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
              className={tokenClass(token)}
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
// ~/~ end
