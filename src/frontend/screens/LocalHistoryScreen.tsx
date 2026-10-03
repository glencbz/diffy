// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-screen-local-history>>[init]
import { type ReactNode, useState } from "react";
import { CombinedLog } from "../controllers/CombinedLog";
import { CommitLog } from "../controllers/CommitLog";
import { DiffPane } from "../controllers/DiffPane";
import { RegisterReview } from "../controllers/RegisterReview";
import type { LocalHistory } from "../model/localHistory";
import { newerOperation, pickerValue } from "../model/localHistory";
import { openLocal, type Place, tabPlace } from "../model/place";
import { useLocalHistoryContext } from "../state/localHistory";
import { usePaneSizes } from "../state/paneSizes";
import { useReviewContext } from "../state/review";
import { GraphsToggle } from "../views/GraphsToggle";
import { InterdiffToggle } from "../views/InterdiffToggle";
import { Message } from "../views/Message";
import { ModeTabs } from "../views/ModeTabs";
import { NewerOperation } from "../views/NewerOperation";
import { OperationPicker } from "../views/OperationPicker";
import { type Pane, ReviewPanes } from "../views/ReviewPanes";
import { ReviewStrip } from "../views/ReviewStrip";
import { ReviewToggle } from "../views/ReviewToggle";

type LocalSideName = "before" | "after";

export function LocalHistoryScreen({ onGo }: { onGo: (place: Place) => void }) {
  const [pane, setPane] = useState<Pane>("after");
  const [interdiff, setInterdiff] = useState(false);
  const [oneGraph, setOneGraph] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [sizes, resize] = usePaneSizes();
  const { history, pickOperation, selectCommits } = useLocalHistoryContext();
  const review = useReviewContext();
  const before = history.status === "ready" ? history.before : null;
  const after = history.status === "ready" ? history.after : null;

  // The before side's row carries the interdiff's own controls.
  const beforeControls = (
    <>
      <GraphsToggle
        oneGraph={oneGraph}
        onToggle={() => setOneGraph(!oneGraph)}
      />
      <InterdiffToggle open onToggle={() => setInterdiff(false)} />
    </>
  );

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
            toggle={beforeControls}
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
        combined={
          <CombinedPicker
            history={history}
            onPick={pickOperation}
            onSelect={selectCommits}
            toggle={beforeControls}
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
        layout={!interdiff ? "log" : oneGraph ? "combined" : "split"}
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

/** One local history side: its operation picker and its commit log, with
 *  `strip` between them when one is passed. */
function SidePicker({
  history,
  side,
  onPick,
  onSelect,
  toggle,
  strip,
}: {
  history: LocalHistory;
  side: LocalSideName;
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

  return (
    <>
      <SideOperation
        history={history}
        side={side}
        label="operation"
        onPick={onPick}
        toggle={toggle}
      />
      {strip}
      <CommitLog
        source={{ kind: "jj", operation: history[side].pick.at }}
        selected={history[side].commits}
        onSelect={onSelect}
      />
    </>
  );
}

/** The one-graph interdiff: both sides' operation pickers, each labelled
 *  with its side, over the graph that combines their logs. */
function CombinedPicker({
  history,
  onPick,
  onSelect,
  toggle,
}: {
  history: LocalHistory;
  onPick: (side: LocalSideName, operationId: string | null) => void;
  onSelect: (side: LocalSideName, commitIds: string[]) => void;
  toggle: ReactNode;
}) {
  if (history.status === "loading") {
    return <Message>Loading operations...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }

  return (
    <>
      <SideOperation
        history={history}
        side="before"
        label="before"
        onPick={(operation) => onPick("before", operation)}
        toggle={toggle}
      />
      <SideOperation
        history={history}
        side="after"
        label="after"
        onPick={(operation) => onPick("after", operation)}
        toggle={null}
      />
      <CombinedLog
        operations={{
          before: history.before.pick.at,
          after: history.after.pick.at,
        }}
        selected={{
          before: history.before.commits,
          after: history.after.commits,
        }}
        onSelect={onSelect}
      />
    </>
  );
}

/** A side's picker row: the operation, then the controls passed in and, for
 *  the after side, the alert that a newer operation has arrived. */
function SideOperation({
  history,
  side,
  label,
  onPick,
  toggle,
}: {
  history: Extract<LocalHistory, { status: "ready" }>;
  side: LocalSideName;
  label: string;
  onPick: (operationId: string | null) => void;
  toggle: ReactNode;
}) {
  const local = history[side];
  const head = history.operations[0]?.id ?? local.pick.at;
  const newer =
    side === "after" ? newerOperation(local, history.operations) : null;

  return (
    <OperationPicker
      operations={history.operations}
      selected={pickerValue(local.pick, head)}
      onSelect={onPick}
      label={label}
    >
      {newer !== null && (
        <NewerOperation operation={newer} onUpdate={() => onPick(null)} />
      )}
      {toggle}
    </OperationPicker>
  );
}
// ~/~ end
