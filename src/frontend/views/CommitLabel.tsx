// ~/~ begin <<docs/architecture/frontend.md#frontend-view-commit-label>>[init]
import type { CommitMarker, CommitRef, LogEntry } from "../api";

const REFS: Record<CommitRef["kind"], string> = {
  bookmark: "commit-ref--bookmark",
  tag: "commit-ref--tag",
  "working-copy": "commit-ref--working-copy",
};

const MARKERS: Record<CommitMarker, { word: string; className: string }> = {
  "working-copy": { word: "@", className: "commit-marker--working-copy" },
  empty: { word: "(empty)", className: "commit-marker--empty" },
  conflict: { word: "conflict", className: "commit-marker--conflict" },
  divergent: { word: "divergent", className: "commit-marker--divergent" },
  hidden: { word: "hidden", className: "commit-marker--hidden" },
};

export function CommitLabel({ commit }: { commit: LogEntry }) {
  const summary = commit.description.split("\n")[0] ?? "";
  const shortCommitId = commit.commitId.slice(0, 8);
  const shortChangeId = commit.changeId?.slice(0, 8) ?? null;

  return (
    <span className="commit-label">
      <span className="commit-label__meta">
        <span
          className={
            shortChangeId !== null
              ? "commit-label__id"
              : "commit-label__id commit-label__id--synthetic"
          }
        >
          {shortChangeId ?? shortCommitId}
        </span>
        <span className="commit-label__author">{commit.author}</span>
        <time className="commit-label__time" dateTime={commit.timestamp}>
          {commit.timestamp.slice(0, 19).replace("T", " ")}
        </time>
        {commit.refs.map((ref) => (
          <span
            key={`${ref.kind}:${ref.name}`}
            className={`commit-ref ${REFS[ref.kind]}`}
          >
            {ref.name}
          </span>
        ))}
        {shortChangeId !== null && (
          <span className="commit-label__commit-id">{shortCommitId}</span>
        )}
        {commit.markers.map((marker) => (
          <span
            key={marker}
            className={`commit-marker ${MARKERS[marker].className}`}
          >
            {MARKERS[marker].word}
          </span>
        ))}
      </span>
      <span className="commit-label__summary">
        {summary || (
          <em className="commit-label__placeholder">(no description)</em>
        )}
      </span>
    </span>
  );
}
// ~/~ end
