// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-view-network>>[init]
import { useState } from "react";
import type { Anchor, ThreadReview } from "../../model/review";
import { type Compared, isOnRequest } from "../../model/runSteps";
import type { Request } from "../../model/runs";
import { CommentComposer, CommentThreads } from "../Comments";

/** The threads on the step's requests, and the anchor a new one takes. */
export interface RequestNotes {
  review: ThreadReview;
  anchorOf: (request: { method: string; url: string }) => Anchor;
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
  notes: RequestNotes | null;
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
                  <button
                    type="button"
                    className="run-row__comment"
                    aria-label={`comment on ${request.method} ${request.url}`}
                    onClick={() => setComposing(key)}
                  >
                    {threads.length > 0 ? threads.length : "+"}
                  </button>
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
                {notes !== null &&
                  (composing === key || threads.length > 0) && (
                    <div className="run-row__notes">
                      {composing === key && (
                        <CommentComposer
                          anchor={notes.anchorOf(request)}
                          onCancel={() => setComposing(null)}
                          onSubmit={(anchor, text) => {
                            notes.review.onAddComment(anchor, text);
                            setComposing(null);
                          }}
                        />
                      )}
                      <CommentThreads
                        comments={threads}
                        onEditComment={notes.review.onEditComment}
                        onResolveComment={notes.review.onResolveComment}
                        onDropComment={notes.review.onDropComment}
                        onReplyToComment={notes.review.onReplyToComment}
                        onEditReply={notes.review.onEditReply}
                        onDropReply={notes.review.onDropReply}
                      />
                    </div>
                  )}
              </li>
            );
          })}
        </ul>
      )}
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
