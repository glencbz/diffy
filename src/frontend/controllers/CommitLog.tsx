// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-commit-log>>[init]
import { useCommitLog } from "../state/commitLog";
import { CommitGraph } from "../views/CommitGraph";
import { Message } from "../views/Message";

export function CommitLog({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (changeId: string) => void;
}) {
  const log = useCommitLog();

  if (log.status === "loading") return <Message>Loading commits...</Message>;
  if (log.status === "error") {
    return <Message tone="error">{log.message}</Message>;
  }

  return (
    <CommitGraph commits={log.data} selected={selected} onSelect={onSelect} />
  );
}
// ~/~ end
