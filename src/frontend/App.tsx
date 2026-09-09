// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { RevisionDiff } from "./controllers/RevisionDiff";
import { SplitPane } from "./views/SplitPane";

export function App() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SplitPane
      left={<CommitLog selected={selected} onSelect={setSelected} />}
      right={<RevisionDiff revision={selected} />}
    />
  );
}
// ~/~ end
