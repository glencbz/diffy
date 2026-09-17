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
        className={
          commit.changeId !== null
            ? "commit-label__id"
            : "commit-label__id commit-label__id--synthetic"
        }
      >
        {shortId}
      </span>
      <span className="commit-label__summary">
        {summary || (
          <em className="commit-label__placeholder">(no description)</em>
        )}
      </span>
    </>
  );
}
// ~/~ end
