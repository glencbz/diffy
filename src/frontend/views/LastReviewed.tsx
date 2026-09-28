// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-last-reviewed>>[init]
import {
  type SeriesBaseline,
  type SeriesVersion,
  versionName,
} from "../model/series";

export function LastReviewed({
  versions,
  reviewed,
  from,
  to,
  toMarked,
  wholeLabel,
  onMark,
  onWhole,
}: {
  versions: SeriesVersion[];
  reviewed: string | null;
  from: SeriesBaseline;
  to: string;
  /** Whether the reader has marked the after version reviewed. */
  toMarked: boolean;
  /** What reading the newest version whole is called: `the whole pull
   *  request`. */
  wholeLabel: string;
  /** Null when there is no review document to write to. */
  onMark: (() => void) | null;
  onWhole: () => void;
}) {
  const known = versions.find((version) => version.id === reviewed);
  const since =
    known !== undefined &&
    from.kind === "version" &&
    from.id === known.id &&
    to === versions.at(-1)?.id;

  return (
    <div className="last-reviewed">
      {since ? (
        <>
          <p className="last-reviewed__note">
            Showing what changed since v{known.number}, the version you last
            reviewed.
          </p>
          <button
            type="button"
            className="last-reviewed__action"
            onClick={onWhole}
          >
            Show {wholeLabel}
          </button>
        </>
      ) : reviewed !== null && known === undefined ? (
        <p className="last-reviewed__note">
          You last reviewed {reviewed.slice(0, 7)}, which this history no longer
          lists, so it opens whole.
        </p>
      ) : null}
      {(toMarked || onMark !== null) && (
        <button
          type="button"
          className="last-reviewed__action"
          onClick={onMark ?? undefined}
          disabled={toMarked}
        >
          {toMarked
            ? `Reviewed at ${versionName(versions, to)}`
            : `Mark reviewed at ${versionName(versions, to)}`}
        </button>
      )}
    </div>
  );
}
// ~/~ end
