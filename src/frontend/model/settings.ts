// ~/~ begin <<docs/architecture/frontend/settings.md#frontend-model-settings>>[init]
import * as z from "zod";

export const TextSize = z.enum(["small", "standard", "large", "larger"]);
export type TextSize = z.infer<typeof TextSize>;

export const DiffMode = z.enum(["structural", "line"]);
export type DiffMode = z.infer<typeof DiffMode>;

export const DiffLayout = z.enum(["unified", "split"]);
export type DiffLayout = z.infer<typeof DiffLayout>;

export const WordMarkLimit = z.union([
  z.literal(0.5),
  z.literal(0.7),
  z.literal(0.9),
]);
export type WordMarkLimit = z.infer<typeof WordMarkLimit>;

const DEFAULT_DISPLAY = {
  textSize: "standard",
  diffMode: "structural",
  diffLayout: "unified",
  wordMarkLimit: 0.7,
} as const;

export const Settings = z.object({
  display: z.object({
    textSize: TextSize,
    diffMode: DiffMode.default(DEFAULT_DISPLAY.diffMode),
    diffLayout: DiffLayout.default(DEFAULT_DISPLAY.diffLayout),
    wordMarkLimit: WordMarkLimit.default(DEFAULT_DISPLAY.wordMarkLimit),
  }),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = { display: DEFAULT_DISPLAY };
// ~/~ end
