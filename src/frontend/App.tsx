// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { Interdiff } from "./controllers/Interdiff";
import { OperationLog } from "./controllers/OperationLog";
import { useSession } from "./state/session";
import { ReviewPanes } from "./views/ReviewPanes";

export function App() {
  const before = useSide();
  const after = useSide();
  const session = useSession();

  return (
    <ReviewPanes
      before={<SidePicker side={before} />}
      after={<SidePicker side={after} />}
      diff={
        <Interdiff from={before.commits} to={after.commits} session={session} />
      }
    />
  );
}

interface Side {
  /** Operation to read this side's log at, or null for the live repo. */
  operation: string | null;
  /** Commit ids selected on this side, in log order. */
  commits: string[];
  selectOperation: (operationId: string | null) => void;
  selectCommits: (commitIds: string[]) => void;
}

function useSide(): Side {
  const [operation, setOperation] = useState<string | null>(null);
  const [commits, setCommits] = useState<string[]>([]);

  return {
    operation,
    commits,
    selectOperation(operationId) {
      setOperation(operationId);
      setCommits([]);
    },
    selectCommits: setCommits,
  };
}

function SidePicker({ side }: { side: Side }) {
  return (
    <>
      <OperationLog selected={side.operation} onSelect={side.selectOperation} />
      <CommitLog
        atOperation={side.operation}
        selected={side.commits}
        onSelect={side.selectCommits}
      />
    </>
  );
}
// ~/~ end
