// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { OperationLog } from "./controllers/OperationLog";
import { RevisionDiff } from "./controllers/RevisionDiff";
import { SplitPane } from "./views/SplitPane";

export function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);

  function selectOperation(operationId: string | null) {
    setOperation(operationId);
    setSelected(null);
  }

  return (
    <SplitPane
      left={
        <>
          <OperationLog selected={operation} onSelect={selectOperation} />
          <CommitLog
            atOperation={operation}
            selected={selected}
            onSelect={setSelected}
          />
        </>
      }
      right={<RevisionDiff revision={selected} atOperation={operation} />}
    />
  );
}
// ~/~ end
