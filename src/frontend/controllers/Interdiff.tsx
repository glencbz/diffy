// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-interdiff>>[init]
import { useInterdiff } from "../state/interdiff";
import { InterdiffRows } from "../views/InterdiffRows";
import { Message } from "../views/Message";

export function Interdiff({ from, to }: { from: string[]; to: string[] }) {
  const interdiff = useInterdiff(from, to);

  if (interdiff === null) {
    return <Message>Select commits on either side to compare them.</Message>;
  }
  if (interdiff.status === "loading") return <Message>Loading diff...</Message>;
  if (interdiff.status === "error") {
    return <Message tone="error">{interdiff.message}</Message>;
  }

  return <InterdiffRows rows={interdiff.data.rows} />;
}
// ~/~ end
