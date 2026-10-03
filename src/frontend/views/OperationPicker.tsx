// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-operation-picker>>[init]
import type { ReactNode } from "react";
import type { OpLogEntry } from "../model/history";

export function OperationPicker({
  operations,
  selected,
  onSelect,
  label = "operation",
  children,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
  /** Names the select; a column holding both sides' pickers names each
   *  after its side. */
  label?: string;
  /** Controls that sit on the picker's row after the select. */
  children?: ReactNode;
}) {
  return (
    <div className="operation-picker">
      <label className="operation-picker__field">
        <span className="operation-picker__label">{label}</span>
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
