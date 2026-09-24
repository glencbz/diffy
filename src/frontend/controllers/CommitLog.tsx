// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-controller-commit-log>>[init]
import type { Source } from "../api";
import { useCommits } from "../state/commits";
import { CommitGraph } from "../views/CommitGraph";
import { Message } from "../views/Message";

export function CommitLog({
  source,
  selected,
  onSelect,
  oldestFirst = false,
}: {
  source: Source;
  selected: string[];
  onSelect?: ((commitIds: string[]) => void) | undefined;
  oldestFirst?: boolean;
}) {
  const log = useCommits(source);

  if (log.status === "loading") return <Message>Loading commits...</Message>;
  if (log.status === "error") {
    return <Message tone="error">{log.message}</Message>;
  }

  return (
    <CommitGraph
      commits={log.data}
      selected={selected}
      onSelect={onSelect}
      oldestFirst={oldestFirst}
    />
  );
}
// ~/~ end
