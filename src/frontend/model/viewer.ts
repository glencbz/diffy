// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-model-viewer>>[init]
import type { Box, Capture, Shown } from "./evidence";

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

/** A capture the reader picked, and the component they were reading
 *  when they picked it. */
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

/** The capture `step` along from `at`, wrapping round. */
export function stepCapture(
  captures: Capture[],
  at: string | null,
  step: -1 | 1,
): string | null {
  if (captures.length === 0) return null;
  const index = captures.findIndex((each) => each.id === at);
  const next = (index + step + captures.length) % captures.length;
  return captures[index === -1 ? 0 : next]?.id ?? null;
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
