// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-comparison-header>>[init]
import type { LogEntry } from "../model/history";
import type { ReviewBarVariant, ReviewedRow } from "../model/review";
import { CommitLabel } from "./CommitLabel";
import { ReviewBar } from "./ReviewBar";

export function ComparisonHeader({
  row,
  plain,
  bar,
}: {
  row: ReviewedRow;
  /** A commit's own diff, which names the one commit and no sides. */
  plain: boolean;
  bar: ReviewBarVariant;
}) {
  return (
    <header className="comparison-header">
      {plain ? (
        <Row caption="commit" commit={row.to ?? row.from} />
      ) : (
        <>
          <Row caption="before" commit={row.from} />
          <Row caption="after" commit={row.to} />
        </>
      )}
      <ReviewBar
        review={row}
        files={row.files}
        commentLabel="comment on comparison"
        variant={bar}
      />
    </header>
  );
}

function Row({
  caption,
  commit,
}: {
  caption: string;
  commit: LogEntry | null;
}) {
  return (
    <div className="comparison-header__row">
      <span className="comparison-header__caption">{caption}</span>
      {commit === null ? (
        <em className="comparison-header__unavailable">not in this series</em>
      ) : (
        <CommitLabel commit={commit} />
      )}
    </div>
  );
}
// ~/~ end
