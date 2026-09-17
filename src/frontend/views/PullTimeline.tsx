// ~/~ begin <<docs/architecture/frontend.md#frontend-view-pull-timeline>>[init]
import type { GitOid, PullHeadOrigin, PullVersion } from "../api";

const AFTER = "#0969da";
const BEFORE = "#bf8700";

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
    <div
      style={{
        flex: "none",
        padding: "6px 10px",
        borderBottom: "1px solid #ccc",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 6,
          overflowX: "auto",
        }}
      >
        {states.map((state) => (
          <Chip
            key={state.head}
            caption={`v${state.version}`}
            detail={`${state.head.slice(0, 7)}  ${when(state.origin)}`}
            accent={accentFor(state.head, before, after)}
            onClick={(shift) => onPick(state.head, shift ? "before" : "after")}
          />
        ))}
      </div>
      <p style={{ margin: "6px 0 0", color: "#888" }}>
        {caption(states, before, after)} · click sets the after end, shift-click
        sets the before end
      </p>
    </div>
  );
}

/** The after end wins when one chip is both, since it is the one being read. */
function accentFor(head: GitOid, before: GitOid, after: GitOid): string | null {
  if (head === after) return AFTER;
  if (head === before) return BEFORE;
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
  accent,
  onClick,
}: {
  caption: string;
  detail: string;
  accent: string | null;
  onClick: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => onClick(event.shiftKey)}
      style={{
        flex: "none",
        padding: "3px 8px",
        border: `1px solid ${accent ?? "#ccc"}`,
        borderRadius: 3,
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        color: accent ?? "inherit",
        background: accent === null ? "#fff" : "#f4f8ff",
      }}
    >
      <span style={{ display: "block", fontWeight: "bold" }}>{caption}</span>
      <span style={{ display: "block", color: "#888", fontSize: 11 }}>
        {detail}
      </span>
    </button>
  );
}
// ~/~ end
