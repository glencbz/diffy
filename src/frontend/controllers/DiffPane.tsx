// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-controller-diff-pane>>[init]

import { changedFilesOf } from "../model/changedFiles";
import { type ReviewedRow, reviewRows } from "../model/review";
import { type Comparison, useComparison } from "../state/comparison";
import type { ReviewHandle } from "../state/review";
import { useSettingsContext } from "../state/settings";
import { useSources } from "../state/source";
import {
  FileNavigator,
  type FileNavigatorGroup,
  type FileNavigatorHeading,
} from "../views/FileNavigator";
import { InterdiffRows, rowAnchor, rowKey } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  review,
}: {
  comparison: Comparison;
  review: ReviewHandle;
}) {
  const answer = useComparison(comparison);
  const { display } = useSettingsContext().settings;
  const sources = useSources(
    answer?.status === "ready" ? answer.data.flatMap((row) => row.files) : [],
  );

  if (answer === null) {
    return <Message>Select commits to see their diff.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }

  const rows = reviewRows(answer.data, review.document);
  const groups: FileNavigatorGroup[] = rows.map((row) => ({
    heading: rows.length > 1 ? rowHeading(row) : null,
    files: changedFilesOf(row.files, rowKey(row), row.comments),
  }));
  const total = groups.reduce((sum, group) => sum + group.files.length, 0);

  return (
    <>
      {total >= 2 && <FileNavigator groups={groups} />}
      <InterdiffRows
        rows={rows}
        plain={comparison.from.length === 0}
        sources={sources}
        review={review.status === "ready" ? review.actions : null}
        display={display}
      />
    </>
  );
}

function rowHeading(row: ReviewedRow): FileNavigatorHeading {
  const commit = row.to ?? row.from;
  const subject = commit?.description.split("\n")[0] ?? "";
  return {
    id: (commit?.changeId ?? commit?.commitId ?? "").slice(0, 8),
    subject: subject === "" ? "(no description)" : subject,
    anchor: rowAnchor(row),
  };
}
// ~/~ end
