// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-diff-pane>>[init]
import { type Comparison, useComparison } from "../state/comparison";
import { DiffView } from "../views/DiffView";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function DiffPane({ comparison }: { comparison: Comparison }) {
  const answer = useComparison(comparison);

  if (answer === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (answer.status === "loading") return <Message>Loading diff...</Message>;
  if (answer.status === "error") {
    return <Message tone="error">{answer.message}</Message>;
  }
  if (answer.data.kind === "jj") {
    return <InterdiffRows rows={answer.data.rows} />;
  }
  if (answer.data.files.length === 0) {
    return <Message>These two versions make the same change.</Message>;
  }

  return <DiffView files={answer.data.files} />;
}
// ~/~ end
