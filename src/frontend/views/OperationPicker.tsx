// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-operation-picker>>[init]
import type { ReactNode } from "react";
import type { OpLogEntry } from "../api";

export function OperationPicker({
  operations,
  selected,
  onSelect,
  children,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
  /** Controls that sit on the picker's row after the select. */
  children?: ReactNode;
}) {
  return (
    <div className="operation-picker">
      <label className="operation-picker__field">
        <span className="operation-picker__label">operation</span>
        <select
          value={selected ?? ""}
          onChange={(event) => onSelect(event.target.value || null)}
          className="operation-picker__select"
        >
          <option value="">latest (current)</option>
          {operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {optionLabel(operation)}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  );
}

export function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
// ~/~ end
