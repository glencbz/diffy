// ~/~ begin <<docs/architecture/frontend.md#frontend-view-commit-label>>[init]
import type { LogEntry } from "../api";

export function CommitLabel({ commit }: { commit: LogEntry }) {
  const summary = commit.description.split("\n")[0] ?? "";
  const shortId =
    commit.changeId !== null
      ? commit.changeId.slice(0, 8)
      : commit.commitId.slice(0, 8);
  return (
    <>
      <span
        style={{
          color: "#888",
          marginRight: 8,
          fontStyle: commit.changeId !== null ? "normal" : "italic",
        }}
      >
        {shortId}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {summary || <em style={{ color: "#999" }}>(no description)</em>}
      </span>
    </>
  );
}
// ~/~ end
