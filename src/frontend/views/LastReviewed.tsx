// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-last-reviewed>>[init]
import {
  type SeriesBaseline,
  type SeriesVersion,
  type VersionMark,
  versionName,
} from "../model/series";

export function LastReviewed({
  versions,
  reviewed,
  from,
  to,
  mark,
  wholeLabel,
  onWhole,
}: {
  versions: SeriesVersion[];
  reviewed: string | null;
  from: SeriesBaseline;
  to: string;
  /** The after version's mark. */
  mark: VersionMark;
  /** What reading the newest version whole is called: `the whole pull
   *  request`. */
  wholeLabel: string;
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
      <MarkButton mark={mark} name={versionName(versions, to)} />
    </div>
  );
}

function MarkButton({ mark, name }: { mark: VersionMark; name: string }) {
  switch (mark.kind) {
    case "marked":
      return (
        <button type="button" className="last-reviewed__action" disabled>
          {`Reviewed at ${name}`}
        </button>
      );
    case "unmarked":
      return (
        <button
          type="button"
          className="last-reviewed__action"
          onClick={mark.onMark}
        >
          {`Mark reviewed at ${name}`}
        </button>
      );
    case "unavailable":
      return null;
  }
}
// ~/~ end
