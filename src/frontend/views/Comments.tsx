// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-comments>>[init]
import { useState } from "react";
import {
  type Anchor,
  drawnAt,
  type LineAnchor,
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

/** Writes a new comment, or rewrites one when given what it says now. */
export function CommentComposer({
  anchor,
  initialBody = "",
  onCancel,
  onSubmit,
}: {
  anchor: Anchor;
  initialBody?: string;
  onCancel: () => void;
  onSubmit: (anchor: Anchor, body: string) => void;
}) {
  return (
    <Composer
      label={composerLabel(anchor)}
      initialBody={initialBody}
      submitLabel={initialBody === "" ? "comment" : "save"}
      onCancel={onCancel}
      onSubmit={(body) => onSubmit(anchor, body)}
    />
  );
}

function Composer({
  label,
  initialBody = "",
  submitLabel,
  onCancel,
  onSubmit,
}: {
  label: string;
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
      <div className="comment-composer__line">{label}</div>
      <textarea
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
}: {
  comments: RowComment[];
  /** The patch of the file line comments are on, to find their lines in. */
  patch?: string;
  onEditComment: (id: string, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
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
}: {
  comment: RowComment;
  onEdit: (body: string) => void;
  at: LineAnchor | null;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentComposer
        anchor={comment}
        initialBody={comment.body}
        onCancel={() => setEditing(false)}
        onSubmit={(_, body) => {
          onEdit(body);
          setEditing(false);
        }}
      />
    );
  }

  const drift = driftNote(comment, at);

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
          <span
            className={
              comment.author === "reader"
                ? undefined
                : "comment-thread__author--other"
            }
          >
            {authorLabel(comment.author)}
          </span>{" "}
          · {threadLabel(comment, at)} ·{" "}
          {comment.resolved ? "resolved" : "open"}
        </span>
        {comment.author === "reader" && (
          <button type="button" onClick={() => setEditing(true)}>
            edit
          </button>
        )}
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        <button type="button" onClick={onDrop}>
          delete
        </button>
      </div>
      <div>{comment.body}</div>
      {drift !== null && <div className="comment-thread__stale">{drift}</div>}
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
// ~/~ end
