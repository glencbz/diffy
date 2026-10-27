// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-view-viewer>>[init]
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Component } from "../../model/components";
import { type BlobName, blobUrl, type Capture } from "../../model/evidence";
import type { Side, ThreadReview } from "../../model/review";
import {
  anchorOn,
  boxBetween,
  boxStyle,
  type Item,
  itemKey,
  modesFor,
  noteNear,
  type Spot,
  type Subject,
  shownAt,
  VIEW_MODE_NAMES,
  type ViewMode,
} from "../../model/viewer";
import { CommentComposer, CommentThreads } from "../Comments";

/** A run's steps, when the item shown is a run. */
export interface Steps {
  labels: string[];
  at: number;
  /** Why the parent stopped, or null. */
  stopped: string | null;
  /** The files the step in focus ran lines of, which the code marks. */
  ran: string[];
  onAt: (index: number) => void;
}

/** The threads on what the viewer shows, and what they are on. */
export interface Notes {
  subject: Subject;
  review: ThreadReview;
}

export function Viewer({
  items,
  shownKey,
  shown,
  steps,
  mode,
  components,
  reading,
  inView,
  onPick,
  onStep,
  onMode,
  onGo,
  notes,
}: {
  /** Every capture and run of the version, for the strip. */
  items: Item[];
  /** The commit in view, whose items the strip draws brighter, or null
   *  while none is. */
  inView: string | null;
  /** The key of the item shown. */
  shownKey: string;
  /** The capture shown, or the run's step in focus as one. */
  shown: Capture;
  steps: Steps | null;
  mode: ViewMode;
  /** The components of the capture's commit, by id. */
  components: ReadonlyMap<string, Component>;
  /** The id of the component under the reading line. */
  reading: string | null;
  onPick: (key: string) => void;
  onStep: (step: -1 | 1) => void;
  onMode: (mode: ViewMode) => void;
  onGo: (component: string) => void;
  /** Null where there is no review to keep comments in. */
  notes: Notes | null;
}) {
  const modes = modesFor(shown);
  const showing = modes.includes(mode) ? mode : "side";
  const [time, setTime] = useState<number | null>(null);
  const [cut, setCut] = useState(0.5);

  // Drawing is the reader's pick of where to comment; the draft is that
  // place, waiting on the words.
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{
    side: Side;
    from: [number, number];
    to: [number, number];
  } | null>(null);
  const [draft, setDraft] = useState<Spot | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new capture starts its clip, its cut and its comment afresh
  useEffect(() => {
    setTime(null);
    setCut(0.5);
    setDrawing(false);
    setDrag(null);
    setDraft(null);
    setLit(null);
  }, [shown.id, shown.commitId]);

  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ onStep, steps, shown, time, drawing, notes });
  latest.current = { onStep, steps, shown, time, drawing, notes };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }
      const now = latest.current;
      // `c` is a copy with a modifier, and only means comment while the
      // viewer is on screen rather than in a tab behind another panel.
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      const onScreen = (root.current?.getClientRects().length ?? 0) > 0;
      if (event.key === "Escape") {
        setDrawing(false);
        setDrag(null);
      } else if (event.key === "c" && plain && onScreen && now.notes !== null) {
        setDrawing(!now.drawing);
        setDrag(null);
      } else if (event.key === "Enter" && now.drawing) {
        // Without a pointer, the whole picture of the commit's side.
        event.preventDefault();
        setDraft({
          side: now.shown.after !== null ? "after" : "before",
          box: null,
          at: now.shown.media === "video" ? (now.time ?? 0) : null,
        });
        setDrawing(false);
      } else if (event.key === "[") now.onStep(-1);
      else if (event.key === "]") now.onStep(1);
      else if (now.steps !== null && (event.key === "," || event.key === ".")) {
        const next = now.steps.at + (event.key === "," ? -1 : 1);
        if (next >= 0 && next < now.steps.labels.length) now.steps.onAt(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A clip that has not played yet is at its start.
  const shows = shownAt(shown, shown.media === "video" ? (time ?? 0) : null);
  const readingHere = shows.some((each) => each.component === reading);
  const boxes = (
    <span className="viewer-boxes">
      {shows.map((each) =>
        each.box === undefined ? null : (
          <button
            key={each.component}
            type="button"
            style={boxStyle(each.box)}
            title={each.about || undefined}
            className={`viewer-box components-kind--${components.get(each.component)?.kind ?? "unknown"}${!readingHere ? "" : each.component === reading ? " viewer-box--reading" : " viewer-box--quiet"}${each.box[1] < 0.06 ? " viewer-box--top" : ""}${each.box[0] + each.box[2] / 2 > 0.6 ? " viewer-box--right" : ""}`}
            onClick={() => onGo(each.component)}
          >
            <span className="viewer-box__name">
              {components.get(each.component)?.name ?? each.component}
            </span>
          </button>
        ),
      )}
    </span>
  );
  const boxesOn = shown.after !== null ? "after" : "before";
  const clipTime = shown.media === "video" ? (time ?? 0) : null;

  const fraction = (event: PointerEvent<HTMLElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    ];
  };
  /** Over a picture while drawing: a drag draws a box, a click takes the
   *  whole picture. */
  const drawLayer = (side: Side) =>
    drawing && (
      <span
        className="viewer-draw"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const at = fraction(event);
          setDrag({ side, from: at, to: at });
        }}
        onPointerMove={(event) => {
          const to = fraction(event);
          setDrag((now) => (now === null ? null : { ...now, to }));
        }}
        onPointerUp={(event) => {
          if (drag === null) return;
          setDraft({
            side: drag.side,
            box: boxBetween(drag.from, fraction(event)),
            at: clipTime,
          });
          setDrag(null);
          setDrawing(false);
        }}
      >
        {drag !== null && drag.side === side && (
          <span
            className="viewer-note viewer-note--draft"
            style={boxStyle(
              boxBetween(drag.from, drag.to) ?? [
                drag.from[0],
                drag.from[1],
                0,
                0,
              ],
            )}
          />
        )}
      </span>
    );

  const threads = notes?.review.comments ?? [];
  const noteNumber = new Map(
    threads.map((each, index) => [each.id, index + 1]),
  );
  /** The boxes of the threads on one side, or on both where one picture
   *  lays the two over each other. */
  const noteBoxes = (side: Side | null) => (
    <>
      {threads.map((comment) => {
        if (
          (comment.kind !== "capture" && comment.kind !== "step") ||
          comment.box === null ||
          (side !== null && comment.side !== side) ||
          !noteNear(comment.kind === "capture" ? comment.at : null, clipTime)
        ) {
          return null;
        }
        return (
          <button
            key={comment.id}
            type="button"
            style={boxStyle(comment.box)}
            className={`viewer-note${comment.resolved ? " viewer-note--resolved" : ""}${lit === comment.id ? " viewer-note--lit" : ""}`}
            aria-label={`thread ${noteNumber.get(comment.id)}`}
            onClick={() => {
              setLit(comment.id);
              document
                .getElementById(`viewer-thread-${comment.id}`)
                ?.scrollIntoView({ block: "nearest" });
            }}
          >
            <span className="viewer-note__number">
              {noteNumber.get(comment.id)}
            </span>
          </button>
        );
      })}
      {draft?.box != null && (side === null || draft.side === side) && (
        <span
          className="viewer-note viewer-note--draft"
          style={boxStyle(draft.box)}
        />
      )}
    </>
  );

  return (
    <div className="viewer" ref={root}>
      <div className="viewer__head">
        <p className="viewer__title">
          <span className="viewer__name">{shown.name}</span>
          {shown.state.map((state) => (
            <span key={state} className="viewer__state">
              {state}
            </span>
          ))}
        </p>
        {notes !== null && (
          <button
            type="button"
            className="viewer__comment"
            aria-pressed={drawing}
            title="Drag a box on a picture, or click one to comment on all of it (c; Enter for the whole picture)"
            onClick={() => {
              setDrawing(!drawing);
              setDrag(null);
            }}
          >
            {drawing ? "drag a box, or click" : "comment"}
          </button>
        )}
        {modes.length > 1 && (
          <span className="viewer__modes">
            {modes.map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={each === showing}
                className="viewer__mode"
                onClick={() => onMode(each)}
              >
                {VIEW_MODE_NAMES[each]}
              </button>
            ))}
          </span>
        )}
      </div>
      {shown.about !== "" && <p className="viewer__about">{shown.about}</p>}
      {steps !== null && (
        <>
          <ol className="viewer__steps">
            {steps.labels.map((label, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a step's place is what it is; two steps can share a label
              <li key={`${index}:${label}`}>
                <button
                  type="button"
                  aria-pressed={index === steps.at}
                  className="viewer__step"
                  onClick={() => steps.onAt(index)}
                >
                  {index + 1}. {label}
                </button>
              </li>
            ))}
          </ol>
          {steps.ran.length > 0 && (
            <p className="viewer__ran">
              <span className="viewer__ran-mark" aria-hidden="true" />
              <span>
                The code marks the lines this step ran in {steps.ran.join(", ")}
                .
              </span>
            </p>
          )}
          {steps.stopped !== null && (
            <p className="viewer__about">
              The parent stopped at {steps.stopped.replace(/\.+$/, "")}.
            </p>
          )}
        </>
      )}
      {showing === "side" ? (
        <div
          className={`viewer__sides${shown.before === null || shown.after === null ? " viewer__sides--one" : ""}`}
        >
          {(["before", "after"] as const).map((side) =>
            shown[side] === null ? (
              <p key={side} className="viewer__none">
                {side === "before"
                  ? "Nothing to show at the parent."
                  : "Nothing to show at this commit."}
              </p>
            ) : (
              <figure key={side} className="viewer__side">
                <figcaption className="viewer__caption">
                  {side === "before" ? "parent" : "this commit"}
                </figcaption>
                <span className={`viewer__frame viewer__frame--${shown.media}`}>
                  <Media
                    capture={shown}
                    name={shown[side] as BlobName}
                    side={side}
                    onTime={side === "after" ? setTime : null}
                  />
                  {side === boxesOn && boxes}
                  {noteBoxes(side)}
                  {drawLayer(side)}
                </span>
              </figure>
            ),
          )}
        </div>
      ) : (
        <div className="viewer__overlay">
          <span
            className={`viewer__frame viewer__frame--${showing}`}
            style={{ "--viewer-cut": cut } as CSSProperties}
          >
            <img
              src={blobUrl(shown.before as BlobName)}
              alt={`${shown.name} at the parent`}
              className="viewer__media"
            />
            <img
              src={blobUrl(shown.after as BlobName)}
              alt={`${shown.name} at this commit`}
              className="viewer__media viewer__media--top"
            />
            {boxes}
            {noteBoxes(null)}
            {drawLayer("after")}
          </span>
          {showing !== "difference" && (
            <label className="viewer__cut">
              <span>parent</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cut}
                onChange={(event) => setCut(Number(event.target.value))}
              />
              <span>this commit</span>
            </label>
          )}
        </div>
      )}
      {notes !== null && (draft !== null || threads.length > 0) && (
        <div className="viewer__notes">
          {draft !== null && (
            <CommentComposer
              anchor={anchorOn(notes.subject, draft)}
              onCancel={() => setDraft(null)}
              onSubmit={(anchor, body) => {
                notes.review.onAddComment(anchor, body);
                setDraft(null);
              }}
            />
          )}
          {threads.map((comment) => (
            <div
              key={comment.id}
              id={`viewer-thread-${comment.id}`}
              className={`viewer__thread${lit === comment.id ? " viewer__thread--lit" : ""}`}
              onPointerEnter={() => setLit(comment.id)}
              onPointerLeave={() => setLit(null)}
            >
              <span className="viewer__thread-number">
                {noteNumber.get(comment.id)}
              </span>
              <CommentThreads
                comments={[comment]}
                onEditComment={notes.review.onEditComment}
                onResolveComment={notes.review.onResolveComment}
                onDropComment={notes.review.onDropComment}
                onReplyToComment={notes.review.onReplyToComment}
                onEditReply={notes.review.onEditReply}
                onDropReply={notes.review.onDropReply}
              />
            </div>
          ))}
        </div>
      )}
      {items.length > 1 && (
        <div className="viewer__strip">
          {items.map((item) => {
            const key = itemKey(item);
            const named =
              item.kind === "capture"
                ? [item.capture.name, ...item.capture.state]
                : [
                    item.run.name,
                    ...item.run.state,
                    `${item.run.after.steps.length} steps`,
                  ];
            const thumb =
              item.kind === "run"
                ? (item.run.after.steps[0]?.shot ?? null)
                : item.capture.media === "image"
                  ? (item.capture.after ?? item.capture.before)
                  : null;
            const about =
              item.kind === "capture" ? item.capture.about : item.run.about;
            const commitId =
              item.kind === "capture"
                ? item.capture.commitId
                : item.run.commitId;
            const elsewhere = inView !== null && commitId !== inView;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === shownKey}
                className={`viewer__thumb viewer__thumb--${item.kind}${elsewhere ? " viewer__thumb--elsewhere" : ""}`}
                title={`${about || named[0]}${elsewhere ? ` (commit ${commitId.slice(0, 8)})` : ""}`}
                onClick={() => onPick(key)}
              >
                {thumb !== null ? (
                  <img src={blobUrl(thumb)} alt="" />
                ) : (
                  <span className="viewer__thumb-clip">▶</span>
                )}
                <span className="viewer__thumb-name">{named.join(" · ")}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One side of a capture. The commit's clip leads its parent's: whatever
 *  the reader does to it, the other does too. */
function Media({
  capture,
  name,
  side,
  onTime,
}: {
  capture: Capture;
  name: BlobName;
  side: "before" | "after";
  onTime: ((time: number) => void) | null;
}) {
  const alt = `${capture.name} ${side === "before" ? "at the parent" : "at this commit"}`;
  if (capture.media === "image") {
    return <img src={blobUrl(name)} alt={alt} className="viewer__media" />;
  }
  const follow = (lead: HTMLVideoElement) => {
    const other = lead
      .closest(".viewer__sides")
      ?.querySelector<HTMLVideoElement>(".viewer__media--before");
    if (other === null || other === undefined) return;
    if (Math.abs(other.currentTime - lead.currentTime) > 0.2) {
      other.currentTime = lead.currentTime;
    }
    if (lead.paused !== other.paused) {
      if (lead.paused) other.pause();
      else void other.play();
    }
  };
  return (
    <video
      src={blobUrl(name)}
      aria-label={alt}
      controls={side === "after"}
      muted
      playsInline
      className={`viewer__media viewer__media--${side}`}
      onTimeUpdate={(event) => {
        onTime?.(event.currentTarget.currentTime);
        if (side === "after") follow(event.currentTarget);
      }}
      onPlay={(event) => side === "after" && follow(event.currentTarget)}
      onPause={(event) => side === "after" && follow(event.currentTarget)}
      onSeeked={(event) => side === "after" && follow(event.currentTarget)}
    />
  );
}
// ~/~ end
