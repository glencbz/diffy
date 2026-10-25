// ~/~ begin <<docs/architecture/backend/recording.md#backend-evidence-recipe>>[init]
import * as z from "zod";

export const Step = z.discriminatedUnion("do", [
  z.object({ do: z.literal("goto"), path: z.string() }),
  z.object({ do: z.literal("click"), selector: z.string() }),
  z.object({
    do: z.literal("fill"),
    selector: z.string(),
    text: z.string(),
  }),
  z.object({ do: z.literal("press"), key: z.string() }),
  z.object({ do: z.literal("wait"), ms: z.number().int().min(0).max(10_000) }),
]);
export type Step = z.infer<typeof Step>;

export const Recipe = z.object({
  path: z.string().default("/"),
  viewport: z
    .object({
      width: z.number().int().min(200).max(2560),
      height: z.number().int().min(200).max(2560),
    })
    .default({ width: 1280, height: 800 }),
  storage: z.record(z.string(), z.string()).default({}),
  steps: z.array(Step).default([]),
  clip: z.boolean().default(false),
});
export type Recipe = z.infer<typeof Recipe>;

/** What a recorder made of a recipe on one side. */
export interface Taken {
  /** The picture or clip, in a directory the caller removes. */
  file: string;
  /** The page's size in the pixels its boxes are measured in. */
  size: { width: number; height: number };
  /** Each selector asked for that matched, by selector. */
  boxes: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  /** Seconds into the clip at which each step was done. */
  done: number[];
  /** The clip's length in seconds, or 0 for a picture. */
  length: number;
}
// ~/~ end
