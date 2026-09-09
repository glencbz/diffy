// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-revision-diff>>[init]
import { useRevisionDiff } from "../state/revisionDiff";
import { DiffView } from "../views/DiffView";
import { Message } from "../views/Message";

export function RevisionDiff({ revision }: { revision: string | null }) {
  const diff = useRevisionDiff(revision);

  if (diff === null) {
    return <Message>Select a commit to see its diff.</Message>;
  }
  if (diff.status === "loading") return <Message>Loading diff...</Message>;
  if (diff.status === "error") {
    return <Message tone="error">{diff.message}</Message>;
  }
  if (diff.data.files.length === 0) {
    return <Message>No changes in this commit.</Message>;
  }

  return <DiffView files={diff.data.files} />;
}
// ~/~ end
