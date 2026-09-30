// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-model-pane-sizes>>[init]
import * as z from "zod";

export type PaneKey = "local-before" | "local-after" | "pull-commits";
export type Axis = "x" | "y";

/** One entry per resizable pane: which way it grows and how small it may get. */
export const PANES: Record<PaneKey, { axis: Axis; min: number }> = {
  "local-before": { axis: "x", min: 160 },
  "local-after": { axis: "x", min: 160 },
  "pull-commits": { axis: "y", min: 48 },
};

/** What a drag must always leave the pane that gives way. */
export const REST = 200;

export const PaneSizes = z.object({
  "local-before": z.number().optional(),
  "local-after": z.number().optional(),
  "pull-commits": z.number().optional(),
});
export type PaneSizes = z.infer<typeof PaneSizes>;

/** Clamps a dragged size between the pane's minimum and what leaves the
 *  neighbouring pane `REST` pixels. The minimum wins when `room` is too small
 *  for both. */
export function clampSize(key: PaneKey, size: number, room: number): number {
  const { min } = PANES[key];
  return Math.round(Math.max(min, Math.min(size, room - REST)));
}
// ~/~ end
