// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-series-comparison-picker>>[init]
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import {
  type SeriesBaseline,
  type SeriesHistory,
  type SeriesVersion,
  versionName,
} from "../model/series";
import { ChangeCount } from "./CommitStack";

export function SeriesComparisonPicker({
  history,
  from,
  to,
  files,
  wholeLabel,
  onPickFrom,
  onPickTo,
}: {
  history: SeriesHistory;
  from: SeriesBaseline;
  to: string;
  /** Everything the `to` version changes against the base. */
  files: AsyncState<FileDiff[]>;
  /** What the whole of one version is called: `whole pull request`. */
  wholeLabel: string;
  onPickFrom: (from: SeriesBaseline) => void;
  onPickTo: (id: string) => void;
}) {
  const { versions, baseLabel, truncated } = history;

  return (
    <div className="pull-compare">
      <label className="pull-compare__field">
        <span className="pull-compare__label">from</span>
        <select
          value={from.kind === "base" ? "base" : from.id}
          onChange={(event) =>
            onPickFrom(parseBaseline(event.target.value, versions))
          }
          className="pull-compare__select"
        >
          <option value="base">{`base (${baseLabel})`}</option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {versionLabel(version)}
            </option>
          ))}
        </select>
      </label>
      <label className="pull-compare__field">
        <span className="pull-compare__label">to</span>
        <select
          value={to}
          onChange={(event) => onPickTo(lookup(event.target.value, versions))}
          className="pull-compare__select"
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {versionLabel(version)}
            </option>
          ))}
        </select>
      </label>
      {files.status === "ready" && (
        <span className="pull-compare__size">
          <span className="pull-compare__label">{wholeLabel}</span>
          <ChangeCount files={files.data} />
        </span>
      )}
      {truncated ? (
        <p className="pull-compare__truncated">
          Some versions are missing here. This pull request was force-pushed
          more times than GitHub's history holds, and it does not say which ones
          were lost.
        </p>
      ) : null}
      <p className="pull-compare__caption">{caption(history, from, to)}</p>
    </div>
  );
}

function parseBaseline(
  value: string,
  versions: SeriesVersion[],
): SeriesBaseline {
  if (value === "base") return { kind: "base" };
  return { kind: "version", id: lookup(value, versions) };
}

function lookup(value: string, versions: SeriesVersion[]): string {
  const version = versions.find((candidate) => candidate.id === value);
  if (version === undefined) {
    throw new Error(`no version of this series is ${value}`);
  }
  return version.id;
}

function versionLabel(version: SeriesVersion): string {
  return `v${version.number} (${version.label})`;
}

function caption(
  { versions, base }: SeriesHistory,
  from: SeriesBaseline,
  to: string,
): string {
  if (from.kind === "base") {
    return `what ${versionName(versions, to)} adds to ${base}`;
  }
  if (from.id === to) {
    return `${versionName(versions, to)} against itself`;
  }
  return `what changed between ${versionName(versions, from.id)} and ${versionName(versions, to)}`;
}
// ~/~ end
