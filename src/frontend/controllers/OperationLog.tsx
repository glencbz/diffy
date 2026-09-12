// ~/~ begin <<docs/architecture/frontend.md#frontend-controller-operation-log>>[init]
import { useOperations } from "../state/operations";
import { Message } from "../views/Message";
import { OperationPicker } from "../views/OperationPicker";

export function OperationLog({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  const operations = useOperations();

  if (operations.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (operations.status === "error") {
    return <Message tone="error">{operations.message}</Message>;
  }

  return (
    <OperationPicker
      operations={operations.data}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
// ~/~ end
