// ~/~ begin <<docs/architecture/frontend/shell.md#frontend-app>>[init]
import { type ReactNode, useState } from "react";
import { CommitLog } from "./controllers/CommitLog";
import { DiffPane } from "./controllers/DiffPane";
import { PullRequests } from "./controllers/PullRequests";
import type { LocalHistory } from "./model/localHistory";
import { newerOperation, pickerValue } from "./model/localHistory";
import type { Place } from "./model/place";
import { useLocalHistory } from "./state/localHistory";
import { usePaneSizes } from "./state/paneSizes";
import { usePlace } from "./state/place";
import { useReview } from "./state/review";
import { SettingsContext, useSettings } from "./state/settings";
import { InterdiffToggle } from "./views/InterdiffToggle";
import { Message } from "./views/Message";
import { type Mode, ModeTabs } from "./views/ModeTabs";
import { NewerOperation } from "./views/NewerOperation";
import { OperationPicker } from "./views/OperationPicker";
import { type Pane, ReviewPanes } from "./views/ReviewPanes";
import { ReviewStrip } from "./views/ReviewStrip";
import { SettingsScreen } from "./views/SettingsScreen";

export function App() {
  const [place, go] = usePlace();
  const [pane, setPane] = useState<Pane>("after");
  const [interdiff, setInterdiff] = useState(false);
  const [sizes, resize] = usePaneSizes();
  const { history, pickOperation, selectCommits } = useLocalHistory();
  const review = useReview();
  const settings = useSettings();
  const before = history.status === "ready" ? history.before : null;
  const after = history.status === "ready" ? history.after : null;

  return (
    <SettingsContext value={settings}>
      <div className="app">
        <ModeTabs
          mode={place.tab}
          onSelect={(mode) => {
            if (mode !== place.tab) go(modePlace(mode));
          }}
        />
        {place.tab !== "settings" && (
          <ReviewStrip
            unavailable={
              review.status === "unavailable" ? review.message : null
            }
            failure={review.failure}
            onDismiss={review.dismissFailure}
          />
        )}
        {place.tab === "local" && (
          <ReviewPanes
            before={
              <SidePicker
                history={history}
                side="before"
                onPick={(operation) => pickOperation("before", operation)}
                onSelect={(commits) => selectCommits("before", commits)}
                toggle={
                  <InterdiffToggle open onToggle={() => setInterdiff(false)} />
                }
              />
            }
            after={
              <SidePicker
                history={history}
                side="after"
                onPick={(operation) => pickOperation("after", operation)}
                onSelect={(commits) => selectCommits("after", commits)}
                toggle={
                  !interdiff && (
                    <InterdiffToggle
                      open={false}
                      onToggle={() => setInterdiff(true)}
                    />
                  )
                }
              />
            }
            diff={
              <DiffPane
                comparison={{
                  from: interdiff ? (before?.commits ?? []) : [],
                  to: after?.commits ?? [],
                }}
                review={review}
              />
            }
            interdiff={interdiff}
            showing={pane}
            onShow={setPane}
            selected={{
              before: before?.commits.length ?? 0,
              after: after?.commits.length ?? 0,
            }}
            sizes={sizes}
            onResize={resize}
          />
        )}
        {place.tab === "pulls" && (
          <PullRequests
            place={place.pull}
            review={review}
            onGo={(pull) => go({ tab: "pulls", pull })}
          />
        )}
        {place.tab === "settings" && (
          <SettingsScreen
            settings={settings.settings}
            onSetTextSize={settings.setTextSize}
            onSetDiffMode={settings.setDiffMode}
            onSetDiffLayout={settings.setDiffLayout}
            onSetWordMarkLimit={settings.setWordMarkLimit}
          />
        )}
      </div>
    </SettingsContext>
  );
}

/** A screen as it opens from its tab, with nothing picked on it yet. */
function modePlace(mode: Mode): Place {
  return mode === "pulls" ? { tab: "pulls", pull: null } : { tab: mode };
}

/** One local history side: its operation picker, its commit log, and, on
 *  the picker's row, the button that opens or closes the interdiff and, for
 *  the after side, the alert that a newer operation has arrived. */
function SidePicker({
  history,
  side,
  onPick,
  onSelect,
  toggle,
}: {
  history: LocalHistory;
  side: "before" | "after";
  onPick: (operationId: string | null) => void;
  onSelect: (commitIds: string[]) => void;
  toggle: ReactNode;
}) {
  if (history.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  const local = history[side];
  const head = history.operations[0]?.id ?? local.pick.at;
  const newer =
    side === "after" ? newerOperation(local, history.operations) : null;

  return (
    <>
      <OperationPicker
        operations={history.operations}
        selected={pickerValue(local.pick, head)}
        onSelect={onPick}
      >
        {newer !== null && (
          <NewerOperation operation={newer} onUpdate={() => onPick(null)} />
        )}
        {toggle}
      </OperationPicker>
      <CommitLog
        source={{ kind: "jj", operation: local.pick.at }}
        selected={local.commits}
        onSelect={onSelect}
      />
    </>
  );
}
// ~/~ end
