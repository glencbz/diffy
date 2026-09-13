// ~/~ begin <<docs/architecture/frontend.md#frontend-view-interdiff-rows>>[init]
import type { InterdiffRow } from "../api";
import { ComparisonHeader } from "./ComparisonHeader";
import { DiffView } from "./DiffView";

export function InterdiffRows({ rows }: { rows: InterdiffRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <section key={rowKey(row)}>
          <ComparisonHeader from={row.from} to={row.to} />
          {row.files.length === 0 ? (
            <p style={{ padding: 12, fontStyle: "italic", color: "#666" }}>
              {row.from !== null && row.to !== null
                ? "Both commits make the same change."
                : "No changes in this commit."}
            </p>
          ) : (
            <DiffView files={row.files} />
          )}
        </section>
      ))}
    </div>
  );
}

function rowKey(row: InterdiffRow): string {
  return `${row.from?.commitId ?? ""}:${row.to?.commitId ?? ""}`;
}
// ~/~ end
