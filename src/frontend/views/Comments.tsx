// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-comments>>[init]
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
// ~/~ end
