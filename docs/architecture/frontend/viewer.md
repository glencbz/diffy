# Viewer

The panel that shows the [captures](../backend/evidence.md#a-capture) an
agent attached to the commit being read, its parent's picture beside the
commit's, with a box on each component the capture shows. It is one of the
[panels](panels.md), and like every panel but the code it follows the
[focus](panels.md#the-focus) rather than leading it.

## Which capture

The viewer shows one capture of the commit in view at a time, or of the
whole version while the reader has not reached a commit yet, so a review
that opens on its full stack still shows what the author recorded. The
reader picks one from the strip under the picture, and it holds while they
read the component they were on. Once they read on, the viewer moves to a
capture that shows the new component, and back to the pick if it shows it.
Following never rewrites the pick: a viewer that did would forget what the
reader chose the moment they scrolled past it.

A capture can only be laid over its other side when both sides are
pictures, so a clip, or a capture with one side missing, is shown side by
side whatever mode the reader chose.

```ts
//| id: frontend-model-viewer
//| file: src/frontend/model/viewer.ts
import type { Box, Capture, Shown } from "./evidence";
import type { Anchor, RowComment, Side } from "./review";
import type { Run } from "./runs";

export const VIEW_MODES = ["side", "swipe", "fade", "difference"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_MODE_NAMES: Record<ViewMode, string> = {
  side: "Side by side",
  swipe: "Swipe",
  fade: "Fade",
  difference: "Difference",
};

/** The captures of one commit, or of every commit while none is in
 *  view, in the order they came. */
export function capturesAt(
  captures: Capture[],
  commitId: string | null,
): Capture[] {
  return commitId === null
    ? captures
    : captures.filter((each) => each.commitId === commitId);
}

/** A capture or run the reader picked, by its key, and the component they
 *  were reading when they picked it. */
export interface Pick {
  id: string;
  reading: string | null;
}

/** The capture to show: the pick until the reader reads on, or while it
 *  shows what they read; else the first that shows it; else the pick,
 *  else the first. */
export function followCapture(
  captures: Capture[],
  picked: Pick | null,
  reading: string | null,
): Capture | null {
  const pick = captures.find((each) => each.id === picked?.id);
  const shows = (capture: Capture) =>
    reading !== null &&
    capture.shows.some((shown) => shown.component === reading);
  if (
    pick !== undefined &&
    (reading === null || reading === picked?.reading || shows(pick))
  ) {
    return pick;
  }
  return captures.find(shows) ?? pick ?? captures[0] ?? null;
}

/** What the strip holds: a capture, or a [run](runs.md) of steps. */
export type Item =
  | { kind: "capture"; capture: Capture }
  | { kind: "run"; run: Run };

/** An item's name in a pick, unique across both kinds. */
export function itemKey(item: Item): string {
  return item.kind === "capture"
    ? `capture:${item.capture.id}`
    : `run:${item.run.id}`;
}

/** The item to show. A picked run holds as a picked capture does, until the
 *  reader reads on to a component some capture shows; captures follow the
 *  reading as `followCapture` says; a commit with only runs shows its
 *  first. */
export function followItem(
  captures: Capture[],
  runs: Run[],
  picked: Pick | null,
  reading: string | null,
): Item | null {
  const run = runs.find((each) => `run:${each.id}` === picked?.id);
  const shownSomewhere =
    reading !== null &&
    captures.some((capture) =>
      capture.shows.some((shown) => shown.component === reading),
    );
  if (
    run !== undefined &&
    (reading === null || reading === picked?.reading || !shownSomewhere)
  ) {
    return { kind: "run", run };
  }
  const capture = followCapture(
    captures,
    picked === null
      ? null
      : { id: picked.id.replace(/^capture:/, ""), reading: picked.reading },
    reading,
  );
  if (capture !== null) return { kind: "capture", capture };
  const first = runs[0];
  return first === undefined ? null : { kind: "run", run: first };
}

/** The key of the item `step` along from `at`, wrapping round. */
export function stepItem(
  items: Item[],
  at: string | null,
  step: -1 | 1,
): string | null {
  if (items.length === 0) return null;
  const index = items.findIndex((each) => itemKey(each) === at);
  const next = (index + step + items.length) % items.length;
  const item = items[index === -1 ? 0 : next];
  return item === undefined ? null : itemKey(item);
}

/** The modes `capture` can be shown in. */
export function modesFor(capture: Capture): ViewMode[] {
  return capture.media === "image" &&
    capture.before !== null &&
    capture.after !== null
    ? [...VIEW_MODES]
    : ["side"];
}

/** What the capture shows `time` seconds into a clip, or at all for a
 *  picture, whose time is null. */
export function shownAt(capture: Capture, time: number | null): Shown[] {
  return capture.shows.filter(
    (shown) =>
      shown.at === undefined ||
      time === null ||
      (time >= shown.at[0] && time <= shown.at[1]),
  );
}

/** A box as CSS offsets within its picture. */
export function boxStyle([left, top, width, height]: Box) {
  const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  return {
    left: percent(left),
    top: percent(top),
    width: percent(width),
    height: percent(height),
  };
}
```

## Going to a component

A box leads to its component in the code, the way an entry in the
[rail](components.md#the-rail) does. The viewer cannot scroll the code
itself, so it asks through the focus, and the components view, which owns
the code's scroll, lands on the component and lets the reading line report
it as it would for any scroll. A box click is a passing move rather than a
place worth a link, so it stays out of the [address](address.md).

## Comments on what it shows

A reader comments on a capture the way they comment on a line: the thread
is filed with the capture's commit, under the same
[review key](review.md#review-state), so it counts toward the
commit's open threads, goes stale when the commit is rewritten, and reaches
the agent through `read_comments`. Its
[anchor](review.md#review-state) names the capture by the id its
commit keeps across versions, and a step of a run by its run's id and its
place, so a thread written on one version finds its picture on the next.

`comment` turns the pictures into a drawing surface for one press: a drag
draws a box, a click takes the whole picture, and on a clip the moment is
the commit's time. The composer then opens under the pictures. A thread's
box is drawn dashed and numbered over its side, beside the component boxes
rather than instead of them, and the same number heads its thread below.
A thread could instead sit in the code under the component the box covers,
but a box drawn round two components, or round a gap between them, would
then have nowhere to go.

```ts
//| id: frontend-model-viewer
/** What the viewer's comments are on: the capture shown, or the step of the
 *  run in focus. */
export type Subject =
  | { kind: "capture"; capture: string }
  | { kind: "step"; run: string; step: number };

/** Where on the picture shown the reader commented: the side, a box or all
 *  of it, and for a clip the moment. */
export interface Spot {
  side: Side;
  box: Box | null;
  at: number | null;
}

export function anchorOn(subject: Subject, spot: Spot): Anchor {
  return subject.kind === "capture"
    ? { kind: "capture", capture: subject.capture, ...spot }
    : {
        kind: "step",
        run: subject.run,
        step: subject.step,
        side: spot.side,
        box: spot.box,
        request: null,
        console: null,
      };
}

/** The threads on `subject`, leaving a step's requests and console lines
 *  to their panels. */
export function notesOn(
  comments: RowComment[],
  subject: Subject,
): RowComment[] {
  return comments.filter((comment) =>
    subject.kind === "capture"
      ? comment.kind === "capture" && comment.capture === subject.capture
      : comment.kind === "step" &&
        comment.run === subject.run &&
        comment.step === subject.step &&
        comment.request === null &&
        comment.console === null,
  );
}

/** Whether a note on a clip is near enough `time` to draw. */
export function noteNear(at: number | null, time: number | null): boolean {
  return at === null || time === null || Math.abs(at - time) <= 1;
}

/** The box a drag from `from` to `to` draws, each a fraction of the
 *  picture, or null for a drag too small to mean one: a click. */
export function boxBetween(
  from: [number, number],
  to: [number, number],
): Box | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const [x0, x1] = [clamp(from[0]), clamp(to[0])].sort((a, b) => a - b) as [
    number,
    number,
  ];
  const [y0, y1] = [clamp(from[1]), clamp(to[1])].sort((a, b) => a - b) as [
    number,
    number,
  ];
  if (x1 - x0 < 0.01 && y1 - y0 < 0.01) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}
```

## The panel

The pictures share one frame, so a box drawn as fractions of the frame
lands on the same spot of either side. Boxes go on the commit's side, the
one the agent measured, or on the parent's when the commit has none. The
component being read stands out and the others dim, so a reader scrolling
the code sees where on screen they are; while nothing on the capture is
being read, every box is drawn alike.

A clip plays both sides together: playing, pausing or seeking the commit's
side does the same to its parent's, and the boxes follow the commit's time.
`[` and `]` step through the commit's captures and runs from anywhere on
the screen, as the panels' own keys do. A run lists its steps under its
name, and `,` and `.` move between them; the step in focus is drawn as a
capture of its two windows, as [runs](runs.md#the-step-in-focus) says.

```tsx
//| id: frontend-view-viewer
//| file: src/frontend/views/Viewer/Viewer.tsx
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
  onPick,
  onStep,
  onMode,
  onGo,
  notes,
}: {
  /** Every capture and run of the commit, for the strip. */
  items: Item[];
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

  const latest = useRef({ onStep, steps });
  latest.current = { onStep, steps };
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
      if (event.key === "Escape") {
        setDrawing(false);
        setDrag(null);
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
    <div className="viewer">
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
            title="Drag a box on a picture, or click one to comment on all of it"
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
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === shownKey}
                className={`viewer__thumb viewer__thumb--${item.kind}`}
                title={about || named[0]}
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
```

## Styling

```css
/*| id: design-viewer
@layer components {
  .viewer {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .viewer__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }

  .viewer__title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
  }

  .viewer__name {
    font-weight: bold;
  }

  .viewer__state {
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .viewer__modes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-size-small);
  }

  .viewer__mode {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .viewer__mode[aria-pressed="true"] {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }

  .viewer__about {
    margin: 0;
    color: var(--text-muted);
  }

  /* Side by side while each side has room for a readable picture, one
     above the other in a narrow panel. */
  .viewer__sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16em, 1fr));
    gap: var(--space-4);
    align-items: start;
  }

  /* With one side missing, the side there is takes the panel's width. */
  .viewer__sides--one {
    grid-template-columns: 1fr;
  }

  .viewer__side {
    margin: 0;
  }

  .viewer__caption {
    margin-bottom: var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .viewer__none {
    margin: 0;
    color: var(--text-faint);
  }

  /* The frame is exactly the picture's size, so boxes kept as fractions of
     the picture land on it. */
  .viewer__frame {
    position: relative;
    display: block;
    border: 1px solid var(--border);
  }

  .viewer__media {
    display: block;
    width: 100%;
    height: auto;
  }

  .viewer__frame--swipe .viewer__media--top,
  .viewer__frame--fade .viewer__media--top,
  .viewer__frame--difference .viewer__media--top {
    position: absolute;
    inset: 0;
  }

  .viewer__frame--swipe .viewer__media--top {
    clip-path: inset(0 0 0 calc((1 - var(--viewer-cut)) * 100%));
  }

  .viewer__frame--fade .viewer__media--top {
    opacity: var(--viewer-cut);
  }

  .viewer__frame--difference .viewer__media--top {
    mix-blend-mode: difference;
  }

  .viewer__cut {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .viewer__cut input {
    flex: 1;
  }

  .viewer-boxes {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .viewer-box {
    position: absolute;
    padding: 0;
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
    background: color-mix(in srgb, var(--component) 12%, transparent);
    border: 2px solid var(--component);
    border-radius: var(--radius);
  }

  .viewer-box--reading {
    background: color-mix(in srgb, var(--component) 22%, transparent);
    box-shadow: 0 0 0 2px var(--surface);
  }

  .viewer-box--quiet {
    opacity: 0.35;
  }

  /* The name hangs above the box, so it never covers what the box shows,
     except at the picture's top edge, where above would cover the
     caption. A box on the right hangs its name from its right edge, so
     the name stays on the picture. */
  .viewer-box__name {
    position: absolute;
    bottom: 100%;
    left: -2px;
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    color: var(--surface);
    white-space: nowrap;
    background: var(--component);
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .viewer-box--top .viewer-box__name {
    top: 0;
    bottom: auto;
    border-radius: 0 0 var(--radius) 0;
  }

  .viewer-box--right .viewer-box__name {
    right: -2px;
    left: auto;
  }

  /* Over a clip the player's controls sit under the boxes, so only a
     box's name answers a click there. */
  .viewer__frame--video .viewer-box {
    pointer-events: none;
  }

  .viewer__frame--video .viewer-box__name {
    pointer-events: auto;
  }

  .viewer__steps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    padding: 0;
    font-size: var(--text-size-small);
    list-style: none;
  }

  .viewer__step {
    padding: var(--space-1) var(--space-2);
    font: inherit;
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .viewer__step[aria-pressed="true"] {
    color: var(--text);
    border-color: var(--accent);
  }

  .viewer__strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .viewer__thumb {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 8em;
    padding: var(--space-1);
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .viewer__thumb[aria-pressed="true"] {
    color: var(--text);
    border-color: var(--accent);
  }

  .viewer__thumb img,
  .viewer__thumb-clip {
    display: block;
    width: 100%;
    height: 4.5em;
    object-fit: cover;
    object-position: top;
  }

  .viewer__thumb-clip {
    display: grid;
    place-items: center;
    background: var(--surface-sunken);
  }

  .viewer__thumb-name {
    overflow-wrap: anywhere;
  }

  .viewer__comment {
    margin-left: auto;
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .viewer__comment[aria-pressed="true"] {
    color: var(--review-open);
    border-color: var(--review-open);
  }

  /* While the reader picks where to comment, the layer takes every press
     on the picture, the component boxes' and the player's too. */
  .viewer-draw {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
    background: color-mix(in srgb, var(--review-open) 6%, transparent);
  }

  /* A thread's box is dashed, so it never reads as a component's. */
  .viewer-note {
    position: absolute;
    padding: 0;
    font: inherit;
    cursor: pointer;
    background: none;
    border: 2px dashed var(--review-open);
    border-radius: var(--radius);
  }

  .viewer-note--resolved {
    border-color: var(--review-resolved);
    opacity: 0.6;
  }

  .viewer-note--lit {
    background: color-mix(in srgb, var(--review-open) 14%, transparent);
    opacity: 1;
  }

  .viewer-note--draft {
    pointer-events: none;
    background: color-mix(in srgb, var(--review-open) 10%, transparent);
  }

  .viewer-note__number,
  .viewer__thread-number {
    display: grid;
    place-items: center;
    min-width: 1.5em;
    height: 1.5em;
    font-size: var(--text-size-small);
    font-weight: bold;
    color: var(--surface);
    background: var(--review-open);
    border-radius: 0.75em;
  }

  /* The number sits on the box's corner, outside what it marks. */
  .viewer-note__number {
    position: absolute;
    top: -0.75em;
    right: -0.75em;
  }

  /* Over a clip only the number answers a click, as only a component
     box's name does. */
  .viewer__frame--video .viewer-note {
    pointer-events: none;
  }

  .viewer__frame--video .viewer-note__number {
    pointer-events: auto;
  }

  .viewer__notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .viewer__notes .comment-composer,
  .viewer__notes .comment-thread {
    margin: 0;
  }

  .viewer__thread {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
  }

  .viewer__thread-number {
    margin-top: var(--space-2);
  }

  .viewer__thread--lit .comment-thread {
    border-color: var(--review-open);
  }
}
```

## Tests

```ts
//| id: frontend-model-viewer-test
//| file: src/frontend/model/viewer.test.ts
import { describe, expect, test } from "bun:test";
import type { Capture } from "./evidence";
import type { Anchor, RowComment } from "./review";
import type { Run } from "./runs";
import {
  anchorOn,
  boxBetween,
  followCapture,
  followItem,
  type Item,
  modesFor,
  notesOn,
  shownAt,
  stepItem,
} from "./viewer";

const PNG = `${"a".repeat(64)}.png` as const;

function run(id: string): Run {
  return {
    series: "local:r",
    version: "1",
    commitId: "c1",
    id,
    name: id,
    state: [],
    about: "",
    before: null,
    after: { steps: [], stopped: null },
    recordedAt: "2026-10-25T00:00:00Z",
  };
}

function capture(id: string, shows: string[], more: Partial<Capture> = {}) {
  return {
    series: "local:r",
    version: "1",
    commitId: "c1",
    id,
    name: id,
    state: [],
    about: "",
    media: "image",
    before: PNG,
    after: PNG,
    shows: shows.map((component) => ({ component, about: "" })),
    attachedAt: "2026-10-24T00:00:00Z",
    ...more,
  } satisfies Capture;
}

describe("following the reading", () => {
  const captures = [
    capture("home", ["header"]),
    capture("settings", ["switch"]),
  ];

  test("keeps the pick while it shows the component being read", () => {
    // act
    const shown = followCapture(
      [...captures, capture("both", ["switch"])],
      { id: "both", reading: null },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("both");
  });

  test("moves to a capture that shows what is read on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "header" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("holds a pick until the reader reads on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "switch" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("home");
  });

  test("keeps the pick when nothing shows what is read", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "settings", reading: null },
      "theme-store",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("starts on the first capture", () => {
    // act
    const shown = followCapture(captures, null, null);

    // assert
    expect(shown?.id).toBe("home");
  });
});

describe("the viewer's choices", () => {
  test("steps round the commit's captures and runs", () => {
    // arrange
    const items: Item[] = [
      { kind: "capture", capture: capture("a", []) },
      { kind: "run", run: run("b") },
    ];

    // act
    const back = stepItem(items, "capture:a", -1);

    // assert
    expect(back).toBe("run:b");
  });

  test("a picked run holds until the reader reads on to a capture", () => {
    // arrange
    const captures = [capture("settings", ["switch"])];
    const runs = [run("switching")];
    const picked = { id: "run:switching", reading: "header" };

    // act
    const held = followItem(captures, runs, picked, "header");
    const moved = followItem(captures, runs, picked, "switch");

    // assert
    expect(held?.kind).toBe("run");
    expect(moved?.kind).toBe("capture");
  });

  test("only lays a picture over its other side", () => {
    // act
    const modes = [
      modesFor(capture("both", [])),
      modesFor(capture("new", [], { before: null })),
      modesFor(capture("clip", [], { media: "video" })),
    ];

    // assert
    expect(modes.map((each) => each.length)).toEqual([4, 1, 1]);
  });

  test("a clip shows a component only within its span", () => {
    // arrange
    const clip = capture("clip", [], {
      media: "video",
      shows: [
        { component: "switch", at: [1, 2], about: "" },
        { component: "header", about: "" },
      ],
    });

    // act
    const early = shownAt(clip, 0.5).map((each) => each.component);

    // assert
    expect(early).toEqual(["header"]);
  });
});
describe("boxBetween", () => {
  test("draws the same box whichever corner the drag starts from", () => {
    // act
    const down = boxBetween([0.1, 0.2], [0.4, 0.6]);
    const up = boxBetween([0.4, 0.6], [0.1, 0.2]);

    // assert
    expect(down).toEqual(up);
    expect(down?.map((each) => Number(each.toFixed(3)))).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });

  test("keeps a drag past the edge on the picture", () => {
    // act
    const box = boxBetween([0.5, 0.5], [1.4, -0.2]);

    // assert
    expect(box).toEqual([0.5, 0, 0.5, 0.5]);
  });

  test("reads a drag too small to see as a click on the whole picture", () => {
    // act
    const box = boxBetween([0.5, 0.5], [0.505, 0.502]);

    // assert
    expect(box).toBeNull();
  });
});

describe("notesOn", () => {
  const comment = (id: string, anchor: Anchor): RowComment => ({
    id,
    reviewKey: "change:a",
    commitId: "c1",
    body: "",
    resolved: false,
    createdAt: "2026-10-26T00:00:00Z",
    author: "reader",
    replies: [],
    stale: false,
    numberedOn: null,
    ...anchor,
  });
  const comments = [
    comment("on-capture", {
      kind: "capture",
      capture: "settings",
      side: "after",
      box: null,
      at: null,
    }),
    comment("on-step", {
      kind: "step",
      run: "checkout",
      step: 1,
      side: "after",
      box: null,
      request: null,
      console: null,
    }),
    comment("on-request", {
      kind: "step",
      run: "checkout",
      step: 1,
      side: "after",
      box: null,
      request: { method: "GET", url: "/api/cart" },
      console: null,
    }),
    comment("other-step", {
      kind: "step",
      run: "checkout",
      step: 0,
      side: "after",
      box: null,
      request: null,
      console: null,
    }),
    comment("on-line", { kind: "line", path: "a.ts", side: "after", line: 1 }),
  ];

  test("finds a capture's threads", () => {
    // act
    const found = notesOn(comments, { kind: "capture", capture: "settings" });

    // assert
    expect(found.map((each) => each.id)).toEqual(["on-capture"]);
  });

  test("finds one step's threads and leaves its requests to Network", () => {
    // act
    const found = notesOn(comments, { kind: "step", run: "checkout", step: 1 });

    // assert
    expect(found.map((each) => each.id)).toEqual(["on-step"]);
  });
});

describe("anchorOn", () => {
  test("anchors a spot on a step to the whole step, not a request", () => {
    // act
    const anchor = anchorOn(
      { kind: "step", run: "checkout", step: 2 },
      { side: "before", box: [0, 0, 1, 1], at: null },
    );

    // assert
    expect(anchor).toEqual({
      kind: "step",
      run: "checkout",
      step: 2,
      side: "before",
      box: [0, 0, 1, 1],
      request: null,
      console: null,
    });
  });
});
```
