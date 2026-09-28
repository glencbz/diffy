// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-controller-diff-pane>>[init]
import { type ReviewedRow, reviewRows } from "../model/review";
import { type Comparison, useComparison } from "../state/comparison";
import type { ReviewHandle } from "../state/review";
import { useSources } from "../state/source";
import { changedFilesOf } from "../views/changedFiles";
import { FileNavigator, type FileNavigatorGroup } from "../views/FileNavigator";
import { InterdiffRows, rowKey } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  review,
}: {
  comparison: Comparison;
  review: ReviewHandle;
}) {
  const answer = useComparison(comparison);
  const sources = useSources(
    answer?.status === "ready" ? answer.data.flatMap((row) => row.files) : [],
  );

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }

  const rows = reviewRows(answer.data, review.document);
  const groups: FileNavigatorGroup[] = rows.map((row) => ({
    label: rows.length > 1 ? rowLabel(row) : null,
    files: changedFilesOf(row.files, rowKey(row), row.comments),
  }));
  const total = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <>
      {total >= 2 && <FileNavigator groups={groups} />}
      <InterdiffRows
        rows={rows}
        sources={sources}
        review={review.status === "ready" ? review.actions : null}
      />
    </>
  );
}

function rowLabel(row: ReviewedRow): string {
  const commit = row.to ?? row.from;
  if (commit === null) return "";
  const subject = commit.description.split("\n")[0];
  return subject !== undefined && subject !== ""
    ? subject
    : commit.commitId.slice(0, 8);
}
// ~/~ end
