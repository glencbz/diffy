// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-timeline>>[init]
import type { GitOid, PullHeadOrigin, PullVersion } from "../api";

type Endpoint = "before" | "after";

export function PullTimeline({
  states,
  before,
  after,
  onPick,
}: {
  states: PullVersion[];
  before: GitOid;
  after: GitOid;
  onPick: (head: GitOid, end: "before" | "after") => void;
}) {
  return (
    <div className="pull-timeline">
      <div className="pull-timeline__row">
        {states.map((state) => (
          <Chip
            key={state.head}
            caption={`v${state.version}`}
            detail={`${state.head.slice(0, 7)}  ${when(state.origin)}`}
            endpoint={endpointFor(state.head, before, after)}
            onClick={(shift) => onPick(state.head, shift ? "before" : "after")}
          />
        ))}
      </div>
      <p className="pull-timeline__caption">
        {caption(states, before, after)} · click sets the after end, shift-click
        sets the before end
      </p>
    </div>
  );
}

/** The after end wins when one chip is both, since it is the one being read. */
function endpointFor(
  head: GitOid,
  before: GitOid,
  after: GitOid,
): Endpoint | null {
  if (head === after) return "after";
  if (head === before) return "before";
  return null;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") return origin.at.slice(0, 10);
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(states: PullVersion[], before: GitOid, after: GitOid): string {
  if (before !== after) {
    return `comparing ${label(states, before)} → ${label(states, after)}`;
  }
  return states.length === 1
    ? `${label(states, after)} is the only version so far`
    : `${label(states, after)} against itself`;
}

function Chip({
  caption,
  detail,
  endpoint,
  onClick,
}: {
  caption: string;
  detail: string;
  endpoint: Endpoint | null;
  onClick: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.shiftKey)}
      className={
        endpoint === null ? "pull-chip" : `pull-chip pull-chip--${endpoint}`
      }
    >
      <span className="pull-chip__caption">{caption}</span>
      <span className="pull-chip__detail">{detail}</span>
    </button>
  );
}
// ~/~ end
