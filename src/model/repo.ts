// ~/~ begin <<docs/architecture/backend/repos.md#model-repo>>[init]
import * as z from "zod";

export const ServedRepo = z.object({
  home: z.string(),
  /** The workspace this tab reads, or null before the reader picks one. */
  current: z.string().nullable(),
});
export type ServedRepo = z.infer<typeof ServedRepo>;

/** What a path turned out to be, by the root of the repository holding it. */
export const Probe = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["jj", "git"]), root: z.string() }),
  z.object({ kind: z.literal("none") }),
]);
export type Probe = z.infer<typeof Probe>;

export const RecentEntry = z.object({
  root: z.string(),
  openedAt: z.string(),
});
export type RecentEntry = z.infer<typeof RecentEntry>;

export const RepoSummary = z.object({
  root: z.string(),
  /** The first line of the working copy's description, empty if it has none. */
  workingCopy: z.string(),
  reviews: z.number(),
  openedAt: z.string().nullable(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

export const FoundRepo = z.object({
  root: z.string(),
  kind: z.enum(["jj", "git"]),
});
export type FoundRepo = z.infer<typeof FoundRepo>;
// ~/~ end
