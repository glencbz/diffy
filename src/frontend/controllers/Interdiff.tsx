// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-interdiff>>[init]
import { useInterdiff } from "../state/interdiff";
import { reviewRows } from "../state/review";
import type { Session } from "../state/session";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function Interdiff({
  from,
  to,
  session,
}: {
  from: string[];
  to: string[];
  session: Session;
}) {
  const interdiff = useInterdiff(from, to);

  if (interdiff === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (interdiff.status === "loading") return <Message>Loading diff...</Message>;
  if (interdiff.status === "error") {
    return <Message tone="error">{interdiff.message}</Message>;
  }

  return (
    <>
      {session.error !== null && (
        <Message tone="error">{session.error}</Message>
      )}
      <InterdiffRows
        rows={reviewRows(interdiff.data.rows, session.document)}
        onMarkSeen={session.markSeen}
        onAddComment={session.addComment}
        onResolveComment={session.resolveComment}
        onDropComment={session.dropComment}
      />
    </>
  );
}
// ~/~ end
