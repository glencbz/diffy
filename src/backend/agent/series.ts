// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-series>>[init]
import * as z from "zod";
import {
  localReview,
  localSeries,
  pullSeries,
} from "../../frontend/model/review";
import { GitError, gitLog, gitMaterialize } from "../commit/git";
import {
  GitHubError,
  githubPullRequestHistory,
  originRepo,
  PullNumber,
  pullPins,
} from "../commit/github";
import { JjError, type JjFileDiff, jjCommits, jjDiff } from "../commit/jj";
import type { ReviewStore } from "../review/store";
import { ToolError } from "./mcp";

/** A commit as a tool names it to the agent. A pull request's commits
 *  have no change ids, so they are named by commit id alone. */
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
  pull: (number: number) => Promise<SeriesTarget>;
  diff: (commitId: string) => Promise<JjFileDiff[]>;
}

function subject(description: string): string {
  return description.split("\n")[0] || "(no description)";
}

export function liveSources(store: ReviewStore): SeriesSources {
  return {
    local: async (name) => {
      const review = localReview(store.read().document, name);
      const version = review?.versions.at(-1);
      if (review === undefined || version === undefined) {
        throw new ToolError(`no local review is named ${name}`);
      }
      const found = await jjCommits(version.commits);
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
    pull: async (number) => {
      const { owner, name } = await originRepo();
      const repo = `${owner}/${name}`;
      const history = await githubPullRequestHistory(
        { owner, name },
        PullNumber.parse(number),
      );
      const state = history.states.at(-1);
      if (state === undefined) throw new ToolError(`#${number} has no head`);
      const [base, tip] = await gitMaterialize(pullPins(history, state));
      if (base === undefined || tip === undefined) {
        throw new Error("gitMaterialize returned fewer oids than asked");
      }
      const commits = await gitLog({ from: base, to: tip, limit: 200 });
      return {
        series: pullSeries(repo, number),
        version: state.head,
        label: `v${state.version}`,
        path: `/pulls/${number}`,
        commits: commits.reverse().map((commit) => ({
          commitId: commit.commitId,
          changeId: null,
          subject: subject(commit.description),
          description: commit.description,
        })),
      };
    },
    diff: (commitId) => jjDiff({ revision: commitId }),
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
  review: z
    .string()
    .min(1)
    .optional()
    .describe("the local review's name, for a local review"),
  pull: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("the pull request's number, for a pull request"),
};

export function targetOf(
  sources: SeriesSources,
  { review, pull }: { review?: string | undefined; pull?: number | undefined },
): Promise<SeriesTarget> {
  if ((review === undefined) === (pull === undefined)) {
    throw new ToolError("name one of review or pull");
  }
  const target =
    review !== undefined ? sources.local(review) : sources.pull(pull as number);
  return target.catch((error: unknown) => {
    if (
      error instanceof JjError ||
      error instanceof GitError ||
      error instanceof GitHubError
    ) {
      throw new ToolError(error.message);
    }
    throw error;
  });
}
// ~/~ end
