// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-screen-local-history>>[init]
import { type ReactNode, useState } from "react";
import { CommitLog } from "../controllers/CommitLog";
import { DiffPane } from "../controllers/DiffPane";
import { RegisterReview } from "../controllers/RegisterReview";
import type { LocalHistory } from "../model/localHistory";
import { newerOperation, pickerValue } from "../model/localHistory";
import { openLocal, type Place, tabPlace } from "../model/place";
import { useLocalHistoryContext } from "../state/localHistory";
import { usePaneSizes } from "../state/paneSizes";
import { useReviewContext } from "../state/review";
import { InterdiffToggle } from "../views/InterdiffToggle";
import { Message } from "../views/Message";
import { ModeTabs } from "../views/ModeTabs";
import { NewerOperation } from "../views/NewerOperation";
import { OperationPicker } from "../views/OperationPicker";
import { type Pane, ReviewPanes } from "../views/ReviewPanes";
import { ReviewStrip } from "../views/ReviewStrip";
import { ReviewToggle } from "../views/ReviewToggle";

export function LocalHistoryScreen({ onGo }: { onGo: (place: Place) => void }) {
  const [pane, setPane] = useState<Pane>("after");
  const [interdiff, setInterdiff] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [sizes, resize] = usePaneSizes();
  const { history, pickOperation, selectCommits } = useLocalHistoryContext();
  const review = useReviewContext();
  const before = history.status === "ready" ? history.before : null;
  const after = history.status === "ready" ? history.after : null;

  return (
    <div className="app">
      <ModeTabs
        mode="local"
        onSelect={(mode) => {
          if (mode !== "local") onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
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
                <>
                  <ReviewToggle
                    open={registering}
                    ticked={after?.commits.length ?? 0}
                    onToggle={() => setRegistering((open) => !open)}
                  />
                  <InterdiffToggle
                    open={false}
                    onToggle={() => {
                      setRegistering(false);
                      setInterdiff(true);
                    }}
                  />
                </>
              )
            }
            strip={
              registering &&
              !interdiff &&
              after !== null && (
                <RegisterReview
                  operation={after.pick.at}
                  ticked={after.commits}
                  onTick={(commits) => selectCommits("after", commits)}
                  onOpen={(name) =>
                    onGo({ tab: "reviews", review: openLocal(name) })
                  }
                  onClose={() => setRegistering(false)}
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
    </div>
  );
}

/** One local history side: its operation picker, its commit log, and, on
 *  the picker's row, the buttons that act on the side and, for the after
 *  side, the alert that a newer operation has arrived. `strip` sits between
 *  the row and the log. */
function SidePicker({
  history,
  side,
  onPick,
  onSelect,
  toggle,
  strip,
}: {
  history: LocalHistory;
  side: "before" | "after";
  onPick: (operationId: string | null) => void;
  onSelect: (commitIds: string[]) => void;
  toggle: ReactNode;
  strip?: ReactNode;
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
      {strip}
      <CommitLog
        source={{ kind: "jj", operation: local.pick.at }}
        selected={local.commits}
        onSelect={onSelect}
      />
    </>
  );
}
// ~/~ end
