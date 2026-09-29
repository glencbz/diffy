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
  return (
    <div className="newer-operation">
      <p className="newer-operation__note">
        A newer operation is available: {optionLabel(operation)}
      </p>
      <button
        type="button"
        className="newer-operation__action"
        onClick={onUpdate}
      >
        Update to latest
      </button>
    </div>
  );
}
// ~/~ end
