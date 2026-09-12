// ~/~ begin <<docs/architecture/frontend.md#frontend-view-operation-picker>>[init]
import type { OpLogEntry } from "../api";

export function OperationPicker({
  operations,
  selected,
  onSelect,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderBottom: "1px solid #ccc",
      }}
    >
      <span style={{ color: "#888" }}>operation</span>
      <select
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        style={{ flex: 1, font: "inherit" }}
      >
        <option value="">latest (current)</option>
        {operations.map((operation) => (
          <option key={operation.id} value={operation.id}>
            {optionLabel(operation)}
          </option>
        ))}
      </select>
    </label>
  );
}

function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
// ~/~ end
