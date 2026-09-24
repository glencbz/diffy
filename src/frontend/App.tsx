// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-app>>[init]
import { useState } from "react";
import type { JjSource, Source } from "./api";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { OperationLog } from "./controllers/OperationLog";
import { PullRequests } from "./controllers/PullRequests";
import { useSession } from "./state/session";
import { DiffModeDefault, useSettings } from "./state/settings";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { type Pane, ReviewPanes } from "./views/ReviewPanes";
import { SettingsScreen } from "./views/SettingsScreen";

/** The repository the pull request screen reads. Next up for configuring. */
const REPO = "glencbz/diffy";

export function App() {
  const [mode, setMode] = useState<Mode>("local");
  const [pane, setPane] = useState<Pane>("before");
  const before = useSide<JjSource>({ kind: "jj", operation: null });
  const after = useSide<JjSource>({ kind: "jj", operation: null });
  const session = useSession();
  const { settings, setTextSize, setDiffMode } = useSettings();

  return (
    <DiffModeDefault value={settings.display.diffMode}>
      <div className="app">
        <ModeTabs mode={mode} onSelect={setMode} />
        {mode === "local" && (
          <ReviewPanes
            before={<SidePicker side={before} />}
            after={<SidePicker side={after} />}
            diff={
              <DiffPane
                comparison={{ from: before.commits, to: after.commits }}
                session={session}
              />
            }
            showing={pane}
            onShow={setPane}
            selected={{
              before: before.commits.length,
              after: after.commits.length,
            }}
          />
        )}
        {mode === "pulls" && <PullRequests repo={REPO} />}
        {mode === "settings" && (
          <SettingsScreen
            settings={settings}
            onSetTextSize={setTextSize}
            onSetDiffMode={setDiffMode}
          />
        )}
      </div>
    </DiffModeDefault>
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
