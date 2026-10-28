// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-review-cover>>[init]
import { useState } from "react";
import { commitRuns, type NamedCommit } from "../model/review";
import { CommitMessage, splitMessage } from "./CommitMessage";

export function ReviewCover({
  name,
  version,
  description,
  commits,
  registeredAt,
  since,
  onPick,
}: {
  name: string;
  /** The version being read, as its chip names it: `v2`. */
  version: string;
  description: string | undefined;
  /** The commits read, oldest first, whose subjects the message can name. */
  commits: NamedCommit[];
  registeredAt: string;
  /** The older version the comparison reads against, with its message, or
   *  null against the base. */
  since: { name: string; description: string | undefined } | null;
  /** Takes the stack to a commit's row. */
  onPick: (commitId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showOld, setShowOld] = useState(false);
  const [folded, setFolded] = useState(false);

  if (description === undefined) return null;

  const { subject } = splitMessage(description);
  const changed =
    since !== null &&
    since.description !== undefined &&
    since.description !== description;
  const plural = commits.length === 1 ? "commit" : "commits";

  return (
    <section className="commit-stack__row review-cover">
      <header className="commit-stack__spine">
        <button
          type="button"
          className="commit-stack__shut"
          aria-expanded={!folded}
          aria-label={
            folded ? "unfold the review's message" : "fold the review's message"
          }
          onClick={() => setFolded((now) => !now)}
        >
          {folded ? "▸" : "▾"}
        </button>
        <span className="commit-stack__id">{version}</span>
        <span className="commit-stack__subject">{subject}</span>
        {since !== null && (
          <span
            className={`review-chip ${changed ? "review-chip--stale" : "review-chip--resolved"}`}
          >
            {changed
              ? `message changed since ${since.name}`
              : `same message as ${since.name}`}
          </span>
        )}
      </header>
      {!folded && (
        <>
          <p className="commit-stack__meta">
            review {name} · {commits.length} {plural} · registered{" "}
            {registeredAt.slice(0, 10)}
          </p>
          <CommitMessage
            description={description}
            className="commit-stack__message"
            isExpanded={expanded}
            onExpand={() => setExpanded((now) => !now)}
            words={(text) =>
              commitRuns(text, commits).map((run, index) =>
                run.kind === "text" ? (
                  run.text
                ) : (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: runs of one fixed text
                    key={index}
                    type="button"
                    className="review-cover__commit"
                    onClick={() => onPick(run.commit)}
                  >
                    {run.text}
                  </button>
                ),
              )
            }
          />
          {changed && (
            <div className="review-cover__old">
              <button
                type="button"
                className="commit-message__expand"
                onClick={() => setShowOld((now) => !now)}
              >
                {showOld
                  ? `hide ${since.name}'s message`
                  : `read ${since.name}'s message`}
              </button>
              {showOld && (
                <CommitMessage
                  description={since.description ?? ""}
                  className="commit-stack__message review-cover__was"
                  isExpanded
                  onExpand={() => setShowOld(false)}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
// ~/~ end
