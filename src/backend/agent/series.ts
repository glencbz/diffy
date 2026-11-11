// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-series>>[init]
import * as z from "zod";
import { localReview, localSeries } from "../../frontend/model/review";
import { gitFiles } from "../commit/git";
import { JjError, type JjFileDiff, jjCommits, jjDiff } from "../commit/jj";
import type { RepoContext } from "../repo/repos";
import { ToolError } from "./mcp";

/** A commit as a tool names it to the agent. */
export interface SeriesCommit {
  commitId: string;
  changeId: string | null;
  subject: string;
  /** The whole message, which a [component map](../frontend/components.md)
   *  quotes from. */
  description: string;
}

/** The newest version of a series, which is the one an agent writes to,
 *  since it is the one the reader opens. */
export interface SeriesTarget {
  series: string;
  version: string;
  /** How the agent is told which version: `v3`. */
  label: string;
  /** The path the reader reads the series at. */
  path: string;
  /** Oldest first. */
  commits: SeriesCommit[];
}

/** Where a tool reads a series and its commits from. */
export interface SeriesSources {
  local: (name: string) => Promise<SeriesTarget>;
  diff: (commitId: string) => Promise<JjFileDiff[]>;
  /** Every file of a revision git names, such as `<commit id>^`. */
  files: (revision: string) => Promise<string[]>;
}

function subject(description: string): string {
  return description.split("\n")[0] || "(no description)";
}

export function liveSources({ root, store }: RepoContext): SeriesSources {
  return {
    local: async (name) => {
      const review = localReview(store.read().document, name);
      const version = review?.versions.at(-1);
      if (review === undefined || version === undefined) {
        throw new ToolError(`no local review is named ${name}`);
      }
      const found = await jjCommits(root, version.commits);
      return {
        series: localSeries(name),
        version: String(review.versions.length),
        label: `v${review.versions.length}`,
        path: `/reviews/${encodeURIComponent(name)}`,
        commits: version.commits.flatMap((id) => {
          const entry = found.get(id);
          return entry === undefined
            ? []
            : [
                {
                  commitId: entry.commitId,
                  changeId: entry.changeId,
                  subject: subject(entry.description),
                  description: entry.description,
                },
              ];
        }),
      };
    },
    diff: (commitId) => jjDiff(root, { revision: commitId }),
    files: (revision) => gitFiles(root, revision),
  };
}

/** The commit of `target` that `name` names, by a prefix of its change id
 *  or its commit id. */
export function commitNamed(target: SeriesTarget, name: string): SeriesCommit {
  const matches = target.commits.filter(
    (commit) =>
      commit.commitId.startsWith(name) ||
      (commit.changeId?.startsWith(name) ?? false),
  );
  const [only, ...others] = matches;
  if (only === undefined || others.length > 0) {
    throw new ToolError(
      `${name} names ${matches.length} commits of ${target.label}, not one`,
    );
  }
  return only;
}

export function short(commit: SeriesCommit): string {
  return (commit.changeId ?? commit.commitId).slice(0, 8);
}

export function pathsOf(file: JjFileDiff): string[] {
  return "path" in file ? [file.path] : [file.oldPath, file.newPath];
}

/** The lines a hunk spans on each side, as `[first, last]`. */

export const Target = {
  review: z.string().min(1).describe("the local review's name"),
};

export function targetOf(
  sources: SeriesSources,
  { review }: { review: string },
): Promise<SeriesTarget> {
  return sources.local(review).catch((error: unknown) => {
    if (error instanceof JjError) {
      throw new ToolError(error.message);
    }
    throw error;
  });
}
// ~/~ end
