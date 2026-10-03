// ~/~ begin <<docs/architecture/frontend/combined-graph.md#frontend-controller-combined-log>>[init]
import { useCommits } from "../state/commits";
import { CombinedGraph } from "../views/CombinedGraph";
import { Message } from "../views/Message";

export function CombinedLog({
  operations,
  selected,
  onSelect,
}: {
  operations: Record<"before" | "after", string>;
  selected: Record<"before" | "after", string[]>;
  onSelect: (side: "before" | "after", commitIds: string[]) => void;
}) {
  const before = useCommits({ kind: "jj", operation: operations.before });
  const after = useCommits({ kind: "jj", operation: operations.after });

  if (before.status === "error") {
    return <Message tone="error">{before.message}</Message>;
  }
  if (after.status === "error") {
    return <Message tone="error">{after.message}</Message>;
  }
  if (before.status === "loading" || after.status === "loading") {
    return <Message>Loading commits...</Message>;
  }

  return (
    <CombinedGraph
      before={before.data}
      after={after.data}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
// ~/~ end
