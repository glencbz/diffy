// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-controller-diff-pane>>[init]
import { type Comparison, useComparison } from "../state/comparison";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { useSources } from "../state/source";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({
  comparison,
  session,
}: {
  comparison: Comparison;
  session: Session;
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

  return (
    <InterdiffRows
      rows={reviewRows(answer.data, session.document)}
      sources={sources}
      onMarkSeen={session.markSeen}
      onAddComment={session.addComment}
      onResolveComment={session.resolveComment}
      onDropComment={session.dropComment}
    />
  );
}
// ~/~ end
