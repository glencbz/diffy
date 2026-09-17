// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { Interdiff } from "./controllers/Interdiff";
import { OperationLog } from "./controllers/OperationLog";
import { ReviewPanes } from "./views/ReviewPanes";

export function App() {
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });

  return (
    <ReviewPanes
      before={<SidePicker side={before} />}
      after={<SidePicker side={after} />}
      diff={<Interdiff from={before.commits} to={after.commits} />}
    />
  );
}

interface Side<S extends Source> {
  /** Where this side's commits come from. */
  source: S;
  /** Commit ids selected on this side, in log order. */
  commits: string[];
  selectSource: (source: S) => void;
  selectCommits: (commitIds: string[]) => void;
}

function useSide<S extends Source>(initial: S): Side<S> {
  const [source, setSource] = useState<S>(initial);
  const [commits, setCommits] = useState<string[]>([]);

  return {
    source,
    commits,
    selectSource(next) {
      setSource(next);
      setCommits([]);
    },
    selectCommits: setCommits,
  };
}

function SidePicker({ side }: { side: Side<JjSource> }) {
  return (
    <>
      <OperationLog
        selected={side.source.operation}
        onSelect={(operation) => side.selectSource({ kind: "jj", operation })}
      />
      <CommitLog
        source={side.source}
        selected={side.commits}
        onSelect={side.selectCommits}
      />
    </>
  );
}
// ~/~ end
