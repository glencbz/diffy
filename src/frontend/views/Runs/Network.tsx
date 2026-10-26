// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-view-network>>[init]
import { useState } from "react";
import type { Anchor, RowComment, ThreadReview } from "../../model/review";
import { type Compared, isOnRequest } from "../../model/runSteps";
import type { Request } from "../../model/runs";
import { CommentComposer, CommentThreads } from "../Comments";

/** The threads on the step's requests or console lines, and the anchor a
 *  new one on `part` takes. */
export interface PartNotes<T> {
  review: ThreadReview;
  anchorOf: (part: T) => Anchor;
}

export function Network({
  label,
  requests,
  notes,
}: {
  /** The step the requests belong to. */
  label: string;
  requests: Compared<Request>[];
  /** Null where there is no review to keep comments in. */
  notes: PartNotes<Request> | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {requests.length === 0 ? (
        <p className="run-panel__none">No requests in this step.</p>
      ) : (
        <ul className="run-list">
          {requests.map((each, index) => {
            const request = (each.after ?? each.before) as Request;
            const key = `${index}:${request.method} ${request.url}`;
            const body = each.after?.body ?? each.before?.body ?? null;
            const threads =
              notes?.review.comments.filter((comment) =>
                isOnRequest(comment, request),
              ) ?? [];
            return (
              <li key={key} className={`run-row run-row--${each.change}`}>
                <button
                  type="button"
                  className="run-row__head"
                  aria-expanded={open === key}
                  disabled={body === null}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  <span className="run-row__change">
                    {CHANGE_MARK[each.change]}
                  </span>
                  <span className="run-row__method">{request.method}</span>
                  <span className="run-row__url">{request.url}</span>
                  <span className="run-row__status">
                    {each.change === "changed"
                      ? `${status(each.before)} → ${status(each.after)}`
                      : status(each.after ?? each.before)}
                  </span>
                  <span className="run-row__type">{request.type}</span>
                </button>
                {notes !== null && (
                  <CommentButton
                    count={threads.length}
                    what={`${request.method} ${request.url}`}
                    onClick={() => setComposing(key)}
                  />
                )}
                {open === key && (
                  <div className="run-row__bodies">
                    {each.change === "changed" &&
                    each.before?.body !== each.after?.body ? (
                      <>
                        <Body title="parent" text={each.before?.body ?? null} />
                        <Body
                          title="this commit"
                          text={each.after?.body ?? null}
                        />
                      </>
                    ) : (
                      <Body title={null} text={body} />
                    )}
                  </div>
                )}
                {notes !== null && (
                  <RowNotes
                    review={notes.review}
                    threads={threads}
                    composing={
                      composing === key ? notes.anchorOf(request) : null
                    }
                    onDone={() => setComposing(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The button at the end of a row: how many threads it holds, or a way to
 *  start one. */
export function CommentButton({
  count,
  what,
  onClick,
}: {
  count: number;
  what: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="run-row__comment"
      aria-label={`comment on ${what}`}
      onClick={onClick}
    >
      {count > 0 ? count : "+"}
    </button>
  );
}

/** The threads under a row, and the composer while the reader writes one. */
export function RowNotes({
  review,
  threads,
  composing,
  onDone,
}: {
  review: ThreadReview;
  threads: RowComment[];
  /** The anchor being written on, or null. */
  composing: Anchor | null;
  onDone: () => void;
}) {
  if (composing === null && threads.length === 0) return null;
  return (
    <div className="run-row__notes">
      {composing !== null && (
        <CommentComposer
          anchor={composing}
          onCancel={onDone}
          onSubmit={(anchor, text) => {
            review.onAddComment(anchor, text);
            onDone();
          }}
        />
      )}
      <CommentThreads
        comments={threads}
        onEditComment={review.onEditComment}
        onResolveComment={review.onResolveComment}
        onDropComment={review.onDropComment}
        onReplyToComment={review.onReplyToComment}
        onEditReply={review.onEditReply}
        onDropReply={review.onDropReply}
      />
    </div>
  );
}

const status = (request: Request | null) =>
  request === null ? "" : (request.status?.toString() ?? "failed");

function Body({ title, text }: { title: string | null; text: string | null }) {
  return (
    <figure className="run-body">
      {title !== null && <figcaption>{title}</figcaption>}
      <pre>{text === null ? "no answer kept" : pretty(text)}</pre>
    </figure>
  );
}

/** JSON laid out to read, anything else as it came. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export const CHANGE_MARK = {
  same: "",
  new: "+",
  gone: "−",
  changed: "~",
} as const;
// ~/~ end
