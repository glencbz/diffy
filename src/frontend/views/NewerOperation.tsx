// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-newer-operation>>[init]
import type { OpLogEntry } from "../api";
import { optionLabel } from "./OperationPicker";

export function NewerOperation({
  operation,
  onUpdate,
}: {
  operation: OpLogEntry;
  onUpdate: () => void;
}) {
  const label = `Update to the newer operation ${optionLabel(operation)}`;
  return (
    <button
      type="button"
      className="newer-operation"
      onClick={onUpdate}
      title={label}
      aria-label={label}
    >
      newer: {operation.id.slice(0, 8)}
    </button>
  );
}
// ~/~ end
