// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { Interdiff } from "./controllers/Interdiff";
import { OperationLog } from "./controllers/OperationLog";
import { ReviewPanes } from "./views/ReviewPanes";

export function App() {
  const before = useSide();
  const after = useSide();

  return (
    <ReviewPanes
      before={<SidePicker side={before} />}
      after={<SidePicker side={after} />}
      diff={<Interdiff from={before.commit} to={after.commit} />}
    />
  );
}

interface Side {
  /** Operation to read this side's log at, or null for the live repo. */
  operation: string | null;
  /** Commit id selected on this side, or null for nothing selected. */
  commit: string | null;
  selectOperation: (operationId: string | null) => void;
  selectCommit: (commitId: string) => void;
}

function useSide(): Side {
  const [operation, setOperation] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);

  return {
    operation,
    commit,
    selectOperation(operationId) {
      setOperation(operationId);
      setCommit(null);
    },
    selectCommit: setCommit,
  };
}

function SidePicker({ side }: { side: Side }) {
  return (
    <>
      <OperationLog selected={side.operation} onSelect={side.selectOperation} />
      <CommitLog
        atOperation={side.operation}
        selected={side.commit}
        onSelect={side.selectCommit}
      />
    </>
  );
}
// ~/~ end
