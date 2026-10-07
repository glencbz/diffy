// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-model-guide>>[init]
import * as z from "zod";

/** A place a guide points the reader at: lines of one file a commit
 *  changes, the whole file without lines, or the commit's message without a
 *  path. Lines count from 1 on `side`, both ends included. */
export const GuideStop = z.object({
  path: z.string().optional(),
  side: z.enum(["before", "after"]).default("after"),
  start: z.number().int().positive().optional(),
  end: z.number().int().positive().optional(),
  note: z.string(),
});
export type GuideStop = z.infer<typeof GuideStop>;

/** One idea of one commit, as the stops that make it up, in reading order. */
export const GuideIdea = z.object({
  /** Unique within the guide, so a link can name it. */
  id: z.string().min(1),
  commitId: z.string(),
  title: z.string(),
  note: z.string().default(""),
  stops: z.array(GuideStop),
});
export type GuideIdea = z.infer<typeof GuideIdea>;

/** One idea relying on another, usually a later commit's payoff on an
 *  earlier commit's setup, and what the link says about why. */
export const GuideLink = z.object({
  from: z.string(),
  to: z.string(),
  say: z.string(),
});
export type GuideLink = z.infer<typeof GuideLink>;

/** What the author of a series wants a reader to take from one version of
 *  it, idea by idea. */
export const Guide = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  /** Each commit's ideas in the order they read best, commits in any order. */
  ideas: z.array(GuideIdea),
  links: z.array(GuideLink).default([]),
});
export type Guide = z.infer<typeof Guide>;

/** The guide to one version of a series, if one was written. */
export function guideTo(
  guides: Guide[],
  series: string,
  version: string,
): Guide | undefined {
  return guides.find(
    (guide) => guide.series === series && guide.version === version,
  );
}

/** `guides` with `guide` in place of any guide to the same version. */
export function withGuide(guides: Guide[], guide: Guide): Guide[] {
  return [
    ...guides.filter(
      (kept) => kept.series !== guide.series || kept.version !== guide.version,
    ),
    guide,
  ];
}
// ~/~ end
