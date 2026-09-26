// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-model-settings>>[init]
import * as z from "zod";

export const TextSize = z.enum(["small", "standard", "large", "larger"]);
export type TextSize = z.infer<typeof TextSize>;

export const DiffMode = z.enum(["structural", "line"]);
export type DiffMode = z.infer<typeof DiffMode>;

const DEFAULT_DISPLAY = {
  textSize: "standard",
  diffMode: "structural",
} as const;

export const Settings = z.object({
  display: z.object({
    textSize: TextSize,
    diffMode: DiffMode.default(DEFAULT_DISPLAY.diffMode),
  }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = { display: DEFAULT_DISPLAY };
// ~/~ end
