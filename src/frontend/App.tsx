// ~/~ begin <<docs/architecture/frontend.md#frontend-app>>[init]
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { OperationLog } from "./controllers/OperationLog";
import { PullRequests } from "./controllers/PullRequests";
import { useSession } from "./state/session";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { ReviewPanes } from "./views/ReviewPanes";

/** The repository the pull request screen reads. Next up for configuring. */
const REPO = "glencbz/diffy";

export function App() {
  const [mode, setMode] = useState<Mode>("local");
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });
  const session = useSession();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <ModeTabs mode={mode} onSelect={setMode} />
      {mode === "local" ? (
        <ReviewPanes
          before={<SidePicker side={before} />}
          after={<SidePicker side={after} />}
          diff={
            <DiffPane
              comparison={{
                kind: "jj",
                from: before.commits,
                to: after.commits,
              }}
              session={session}
            />
          }
        />
      ) : (
        <PullRequests repo={REPO} session={session} />
      )}
    </div>
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
