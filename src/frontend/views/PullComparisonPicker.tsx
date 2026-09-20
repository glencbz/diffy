// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-pull-comparison-picker>>[init]
import type {
  GitOid,
  PullBaseline,
  PullHeadOrigin,
  PullHistory,
  PullVersion,
} from "../api";

export function PullComparisonPicker({
  history,
  from,
  to,
  onPickFrom,
  onPickTo,
}: {
  history: PullHistory;
  from: PullBaseline;
  to: GitOid;
  onPickFrom: (from: PullBaseline) => void;
  onPickTo: (head: GitOid) => void;
}) {
  const { states, baseRefName, baseRefOid, truncated } = history;

  return (
    <div className="pull-compare">
      <label className="pull-compare__field">
        <span className="pull-compare__label">from</span>
        <select
          value={from.kind === "base" ? "base" : from.head}
          onChange={(event) =>
            onPickFrom(parseBaseline(event.target.value, states))
          }
          className="pull-compare__select"
        >
          <option value="base">{`base (${baseRefName} @ ${baseRefOid.slice(0, 7)})`}</option>
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      <label className="pull-compare__field">
        <span className="pull-compare__label">to</span>
        <select
          value={to}
          onChange={(event) => onPickTo(lookupHead(event.target.value, states))}
          className="pull-compare__select"
        >
          {states.map((state) => (
            <option key={state.head} value={state.head}>
              {versionLabel(state)}
            </option>
          ))}
        </select>
      </label>
      {truncated ? (
        <p className="pull-compare__truncated">
          Some versions are missing here. This pull request was force-pushed
          more times than GitHub's history holds, and it does not say which ones
          were lost.
        </p>
      ) : null}
      <p className="pull-compare__caption">
        {caption(states, baseRefName, from, to)}
      </p>
    </div>
  );
}

function parseBaseline(value: string, states: PullVersion[]): PullBaseline {
  if (value === "base") return { kind: "base" };
  return { kind: "version", head: lookupHead(value, states) };
}

function lookupHead(value: string, states: PullVersion[]): GitOid {
  const state = states.find((candidate) => candidate.head === value);
  if (state === undefined) {
    throw new Error(`no version of this pull request has head ${value}`);
  }
  return state.head;
}

function versionLabel(state: PullVersion): string {
  return `v${state.version} (${state.head.slice(0, 7)}, ${when(state.origin)})`;
}

function when(origin: PullHeadOrigin): string {
  if (origin.kind === "force-pushed") {
    return `force-pushed ${origin.at.slice(0, 10)}`;
  }
  return origin.kind;
}

function label(states: PullVersion[], head: GitOid): string {
  const state = states.find((candidate) => candidate.head === head);
  return state === undefined ? head.slice(0, 7) : `v${state.version}`;
}

function caption(
  states: PullVersion[],
  baseRefName: string,
  from: PullBaseline,
  to: GitOid,
): string {
  if (from.kind === "base") {
    return `what ${label(states, to)} adds to ${baseRefName}`;
  }
  if (from.head === to) {
    return `${label(states, to)} against itself`;
  }
  return `what changed between ${label(states, from.head)} and ${label(states, to)}`;
}
// ~/~ end
