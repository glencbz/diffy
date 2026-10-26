// ~/~ begin <<docs/architecture/frontend/threads.md#frontend-view-thread-list>>[init]
import { useState } from "react";
import {
  evidenceLabel,
  type ReviewActions,
  type RowComment,
} from "../model/review";
import {
  byVersion,
  type SeriesThread,
  type ThreadFilter,
  threadsIn,
} from "../model/threads";
import { CommentThreads } from "./Comments";

const FILTERS: ThreadFilter[] = ["open", "resolved", "all"];

export function ThreadList({
  threads,
  actions,
  onGo,
}: {
  threads: SeriesThread[];
  /** Null while there is no review document to write to. */
  actions: ReviewActions | null;
  onGo: (thread: SeriesThread) => void;
}) {
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const unfold = (id: string, open: boolean) =>
    setUnfolded((now) => {
      const next = new Set(now);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const shown = threadsIn(threads, filter);

  return (
    <div className="thread-list">
      <div className="thread-list__filters">
        {FILTERS.map((each) => (
          <button
            type="button"
            key={each}
            aria-pressed={filter === each}
            onClick={() => setFilter(each)}
            className="thread-list__filter"
          >
            {each}{" "}
            <span className="thread-list__count">
              {threadsIn(threads, each).length}
            </span>
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="thread-list__empty">
          {threads.length === 0
            ? "No comments on this review yet."
            : `No ${filter} threads.`}
        </p>
      )}
      {byVersion(shown).map(({ version, threads: run }) => (
        <section key={version.id} className="thread-list__version">
          <h3 className="thread-list__heading">
            Written on v{version.number}
            <span className="thread-list__label">{version.label}</span>
          </h3>
          <ul className="thread-list__threads">
            {run.map((thread) => (
              <ThreadEntry
                key={thread.comment.id}
                thread={thread}
                actions={actions}
                onGo={() => onGo(thread)}
                unfolded={unfolded.has(thread.comment.id)}
                onUnfold={(open) => unfold(thread.comment.id, open)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ThreadEntry({
  thread,
  actions,
  onGo,
  unfolded,
  onUnfold,
}: {
  thread: SeriesThread;
  actions: ReviewActions | null;
  onGo: () => void;
  unfolded: boolean;
  onUnfold: (open: boolean) => void;
}) {
  const { comment } = thread;
  const replies = comment.replies.length;
  return (
    <li
      className={
        comment.resolved
          ? "thread-entry thread-entry--resolved"
          : "thread-entry"
      }
    >
      <div className="thread-entry__line">
        <button
          type="button"
          aria-expanded={unfolded}
          aria-label={unfolded ? "fold thread" : "unfold thread"}
          onClick={() => onUnfold(!unfolded)}
          className="thread-entry__fold"
        >
          {unfolded ? "▾" : "▸"}
        </button>
        <button type="button" onClick={onGo} className="thread-entry__where">
          {whereOf(thread)}
        </button>
        <span
          className={`thread-entry__shown thread-entry__shown--${shown(thread)}`}
        >
          {SHOWN[shown(thread)]}
        </span>
        {replies > 0 && (
          <span className="thread-entry__replies">
            {replies === 1 ? "1 reply" : `${replies} replies`}
          </span>
        )}
        {actions !== null && (
          <button
            type="button"
            onClick={() =>
              actions.resolveComment(comment.id, !comment.resolved)
            }
            className="thread-entry__resolve"
          >
            {comment.resolved ? "reopen" : "resolve"}
          </button>
        )}
      </div>
      {unfolded && actions !== null ? (
        <div className="thread-entry__thread">
          <CommentThreads
            comments={[asDrawn(thread)]}
            patch={thread.drawn?.patch}
            onEditComment={actions.editComment}
            onResolveComment={actions.resolveComment}
            onDropComment={actions.dropComment}
            onReplyToComment={actions.replyToComment}
            onEditReply={actions.editReply}
            onDropReply={actions.dropReply}
          />
          <button type="button" onClick={onGo} className="thread-entry__go">
            {thread.drawn !== null
              ? "show it in the diff"
              : `open v${thread.written.number}, where it was written`}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onUnfold(true)}
          className="thread-entry__excerpt"
        >
          {comment.body}
        </button>
      )}
    </li>
  );
}

type Shown = "drawn" | "hidden" | "dropped";

const SHOWN: Record<Shown, string> = {
  drawn: "in view",
  hidden: "not in view",
  dropped: "change dropped",
};

function shown(thread: SeriesThread): Shown {
  if (thread.drawn !== null) return "drawn";
  return thread.dropped ? "dropped" : "hidden";
}

/** The file's name, not its path: the list is narrow, and the subject of the
 *  thread's commit is a click away. */
function whereOf({ comment }: SeriesThread): string {
  if (comment.kind === "comparison") return "whole commit";
  if (comment.kind === "capture" || comment.kind === "step") {
    return evidenceLabel(comment);
  }
  const name = comment.path.split("/").at(-1) ?? comment.path;
  if (comment.kind === "file") return name;
  return comment.side === "after"
    ? `${name}:${comment.line}`
    : `${name}:${comment.line}, before`;
}

function asDrawn(thread: SeriesThread): RowComment {
  return (
    thread.drawn?.comment ?? {
      ...thread.comment,
      stale: false,
      numberedOn: null,
    }
  );
}
// ~/~ end
