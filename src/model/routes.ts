// ~/~ begin <<docs/architecture/backend/server.md#model-routes>>[init]
import * as z from "zod";
import { InterdiffResponse, ServedFileDiff } from "./diff";
import { GitCommit, LogEntry, OpLogEntry } from "./history";
import { FoundRepo, Probe, RepoSummary, ServedRepo } from "./repo";
import { SourceFile } from "./source";

/** One read the browser asks of the server: where, and what comes back. */
export interface Read<Answer extends z.ZodType> {
  path: `/api/${string}`;
  answer: Answer;
}

/** What a handler has to build to answer `Route`. */
export type Answer<Route extends Read<z.ZodType>> = z.input<Route["answer"]>;

function read<Answer extends z.ZodType>(
  path: `/api/${string}`,
  answer: Answer,
): Read<Answer> {
  return { path, answer };
}

const Files = z.object({ files: z.array(ServedFileDiff) });

export const READS = {
  log: read("/api/log", z.array(LogEntry)),
  operations: read("/api/operations", z.array(OpLogEntry)),
  interdiff: read("/api/interdiff", InterdiffResponse),
  source: read("/api/source", SourceFile),
  compare: read("/api/compare", z.object({ file: ServedFileDiff })),
  comparePaths: read(
    "/api/compare/paths",
    z.object({ paths: z.array(z.string()) }),
  ),
  localCommits: read("/api/local/commits", z.array(GitCommit)),
  localDiff: read("/api/local/diff", Files),
  localSize: read("/api/local/size", Files),
  repo: read("/api/repo", ServedRepo),
  repoProbe: read("/api/repo/probe", Probe),
  recentRepos: read("/api/repo/recent", z.array(RepoSummary)),
  foundRepos: read("/api/repo/found", z.array(FoundRepo)),
};
// ~/~ end
