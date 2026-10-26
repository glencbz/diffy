// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-model-viewer>>[init]
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-model-viewer>>[1]
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
      };
}

/** The threads on `subject`, leaving a step's requests to the Network
 *  panel. */
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
        comment.request === null,
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
// ~/~ end
