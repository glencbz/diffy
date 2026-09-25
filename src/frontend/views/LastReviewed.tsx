// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-last-reviewed>>[init]
import type { GitOid, PullBaseline, PullVersion } from "../api";

export function LastReviewed({
  states,
  reviewed,
  from,
  to,
  onMark,
  onWhole,
}: {
  states: PullVersion[];
  reviewed: GitOid | null;
  from: PullBaseline;
  to: GitOid;
  onMark: () => void;
  onWhole: () => void;
}) {
  const known = states.find((state) => state.head === reviewed);
  const since =
    known !== undefined &&
    from.kind === "version" &&
    from.head === known.head &&
    to === states.at(-1)?.head;

  return (
    <div className="last-reviewed">
      {since ? (
        <>
          <p className="last-reviewed__note">
            Showing what changed since v{known.version}, the head you last
            reviewed.
          </p>
          <button
            type="button"
            className="last-reviewed__action"
            onClick={onWhole}
          >
            Show the whole pull request
          </button>
        </>
      ) : reviewed !== null && known === undefined ? (
        <p className="last-reviewed__note">
          You last reviewed {reviewed.slice(0, 7)}, which this pull request's
          history no longer lists, so it opens whole.
        </p>
      ) : null}
      <button
        type="button"
        className="last-reviewed__action"
        onClick={onMark}
        disabled={to === reviewed}
      >
        {to === reviewed
          ? `Reviewed at ${name(states, to)}`
          : `Mark reviewed at ${name(states, to)}`}
      </button>
    </div>
  );
}

function name(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}
// ~/~ end
