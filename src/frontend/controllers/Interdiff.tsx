// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-interdiff>>[init]
import { useInterdiff } from "../state/interdiff";
import { ComparisonHeader } from "../views/ComparisonHeader";
import { DiffView } from "../views/DiffView";
import { Message } from "../views/Message";

export function Interdiff({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}) {
  const interdiff = useInterdiff(from, to);

  if (interdiff === null) {
    return <Message>Select a commit on either side to see a diff.</Message>;
  }
  if (interdiff.status === "loading") return <Message>Loading diff...</Message>;
  if (interdiff.status === "error") {
    return <Message tone="error">{interdiff.message}</Message>;
  }

  const { from: before, to: after, files } = interdiff.data;
  const paired = before !== null && after !== null;

  return (
    <>
      <ComparisonHeader from={before} to={after} />
      {files.length === 0 ? (
        <Message>
          {paired
            ? "These two commits make the same change."
            : "No changes in this commit."}
        </Message>
      ) : (
        <DiffView files={files} />
      )}
    </>
  );
}
// ~/~ end
