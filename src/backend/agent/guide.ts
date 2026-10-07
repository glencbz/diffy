// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-guide>>[init]
import * as z from "zod";
import {
  type Guide,
  type GuideIdea,
  GuideLink,
  GuideStop,
  guideTo,
} from "../../frontend/model/guide";
import { readPatch } from "../../frontend/model/patch";
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
import { type Tool, ToolError, tool } from "./mcp";
import { AGENT } from "./review";

/** A commit as a guide names it to the agent. A pull request's commits
 *  have no change ids, so they are named by commit id alone. */
export interface GuideCommit {
  commitId: string;
  changeId: string | null;
  subject: string;
}

/** The newest version of a series, which is the one a guide is written to,
 *  since it is the one the reader opens. */
export interface GuideTarget {
  series: string;
  version: string;
  /** How the agent is told which version: `v3`. */
  label: string;
  /** The path the reader reads the series at. */
  path: string;
  /** Oldest first. */
  commits: GuideCommit[];
}

/** Where a guide's series and its commits are read from. */
export interface GuideSources {
  local: (name: string) => Promise<GuideTarget>;
  pull: (number: number) => Promise<GuideTarget>;
  diff: (commitId: string) => Promise<JjFileDiff[]>;
}

function subject(description: string): string {
  return description.split("\n")[0] || "(no description)";
}

function liveSources(store: ReviewStore): GuideSources {
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
        })),
      };
    },
    diff: (commitId) => jjDiff({ revision: commitId }),
  };
}

/** The commit of `target` that `name` names, by a prefix of its change id
 *  or its commit id. */
function commitNamed(target: GuideTarget, name: string): GuideCommit {
  const matches = target.commits.filter(
    (commit) =>
      commit.commitId.startsWith(name) ||
      (commit.changeId?.startsWith(name) ?? false),
  );
  const [only, ...others] = matches;
  if (only === undefined || others.length > 0) {
    throw new ToolError(
      `${name} names ${matches.length} commits of the ${target.label} you are guiding, not one`,
    );
  }
  return only;
}

function short(commit: GuideCommit): string {
  return (commit.changeId ?? commit.commitId).slice(0, 8);
}

function pathsOf(file: JjFileDiff): string[] {
  return "path" in file ? [file.path] : [file.oldPath, file.newPath];
}

/** The lines a hunk spans on each side, as `[first, last]`. */
function spans(file: JjFileDiff) {
  return readPatch(file.patch).hunks.map((hunk) => {
    const after = hunk.lines.flatMap((line) =>
      "newLine" in line ? [line.newLine] : [],
    );
    const before = hunk.lines.flatMap((line) =>
      "oldLine" in line && line.oldLine !== undefined ? [line.oldLine] : [],
    );
    const range = (lines: number[]) =>
      lines.length === 0
        ? null
        : ([Math.min(...lines), Math.max(...lines)] as const);
    return { after: range(after), before: range(before) };
  });
}

function covers(stop: GuideStop, span: ReturnType<typeof spans>[number]) {
  if (stop.start === undefined) return true;
  const range = stop.side === "before" ? span.before : span.after;
  const end = stop.end ?? stop.start;
  return range !== null && stop.start <= range[1] && end >= range[0];
}

/** Ranges a file's line is named by, up to `SHOWN` of them. */
const SHOWN = 4;

/** The hunks of `files` no stop of `ideas` covers, one line per file, as
 *  `path: first-last, first-last`. */
function uncovered(files: JjFileDiff[], ideas: GuideIdea[]): string[] {
  return files.flatMap((file) => {
    const paths = pathsOf(file);
    const stops = ideas.flatMap((idea) =>
      idea.stops.filter(
        (stop) => stop.path !== undefined && paths.includes(stop.path),
      ),
    );
    const path = paths.at(-1) ?? "";
    const ranges = spans(file).flatMap((span) => {
      if (stops.some((stop) => covers(stop, span))) return [];
      const [first, last] = span.after ?? span.before ?? [0, 0];
      return [`${first}-${last}`];
    });
    if (ranges.length === 0) return [];
    const more = ranges.length - SHOWN;
    return [
      `${path}: ${ranges.slice(0, SHOWN).join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    ];
  });
}

const Target = {
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

function targetOf(
  sources: GuideSources,
  { review, pull }: { review?: string | undefined; pull?: number | undefined },
): Promise<GuideTarget> {
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

const IdeaInput = z.object({
  id: z
    .string()
    .min(1)
    .describe("a name for the idea, unique in the guide, that links use"),
  commit: z
    .string()
    .min(1)
    .describe("the change id or commit id the idea belongs to, or a prefix"),
  title: z.string().min(1).describe("the idea in a few words"),
  note: z
    .string()
    .default("")
    .describe("what the idea is and why, before its first stop"),
  stops: z
    .array(GuideStop)
    .min(1)
    .describe(
      "the places the idea is made, in reading order: a path with lines start to end on side (after unless the lines were removed), a path alone for a whole file, or no path for the commit's message. Each note says what to see there.",
    ),
});

export function guideTools(
  store: ReviewStore,
  sources: GuideSources = liveSources(store),
): Tool[] {
  return [
    tool({
      name: "write_guide",
      description:
        "Write the guide a reader follows through the newest version of a local review or a pull request, replacing any guide to that version. Group each commit's changes into ideas, each a few stops in reading order, and link an idea to an earlier commit's idea it relies on. Answers with the reader's link and the changed lines no stop covers, which the reader is shown after the ideas.",
      input: z.object({
        ...Target,
        ideas: z.array(IdeaInput).min(1),
        links: z
          .array(GuideLink)
          .default([])
          .describe(
            "from the id of an idea to the id of an idea it relies on, with say telling the reader why",
          ),
      }),
      call: async ({ review, pull, ideas, links }, { origin }) => {
        const target = await targetOf(sources, { review, pull });
        const ids = new Set<string>();
        const resolved = ideas.map((idea): GuideIdea => {
          if (ids.has(idea.id)) {
            throw new ToolError(`two ideas are called ${idea.id}`);
          }
          ids.add(idea.id);
          for (const stop of idea.stops) {
            if (
              stop.end !== undefined &&
              (stop.start === undefined || stop.end < stop.start)
            ) {
              throw new ToolError(
                `a stop of ${idea.id} ends at ${stop.end} without starting before it`,
              );
            }
          }
          const { commit, ...rest } = idea;
          return { ...rest, commitId: commitNamed(target, commit).commitId };
        });
        for (const link of links) {
          for (const id of [link.from, link.to]) {
            if (!ids.has(id)) throw new ToolError(`no idea is called ${id}`);
          }
          if (link.from === link.to) {
            throw new ToolError(`${link.from} links to itself`);
          }
        }

        const missed: string[] = [];
        for (const commit of target.commits) {
          const own = resolved.filter(
            (idea) => idea.commitId === commit.commitId,
          );
          if (own.length === 0) {
            missed.push(`${short(commit)} has no ideas`);
            continue;
          }
          const files = await sources.diff(commit.commitId);
          const paths = new Set(files.flatMap(pathsOf));
          for (const idea of own) {
            for (const stop of idea.stops) {
              if (stop.path !== undefined && !paths.has(stop.path)) {
                throw new ToolError(
                  `${short(commit)} does not change ${stop.path}, which a stop of ${idea.id} names`,
                );
              }
            }
          }
          for (const hunk of uncovered(files, own)) {
            missed.push(`${short(commit)} ${hunk}`);
          }
        }

        const guide: Guide = {
          series: target.series,
          version: target.version,
          author: AGENT,
          writtenAt: new Date().toISOString(),
          ideas: resolved,
          links,
        };
        store.apply({ kind: "write-guide", guide });
        return [
          `${origin}${target.path}`,
          `the guide to ${target.label}: ${resolved.length} ideas over ${new Set(resolved.map((idea) => idea.commitId)).size} of ${target.commits.length} commits, ${links.length} links`,
          ...(missed.length === 0
            ? ["every changed line is on a stop"]
            : ["not on any stop:", ...missed.map((line) => `  ${line}`)]),
        ].join("\n");
      },
    }),
    tool({
      name: "read_guide",
      description:
        "Read the guide to the newest version of a local review or a pull request as JSON, in the shape write_guide takes, so it can be edited and written back.",
      input: z.object(Target),
      call: async ({ review, pull }) => {
        const target = await targetOf(sources, { review, pull });
        const guide = guideTo(
          store.read().document.guides,
          target.series,
          target.version,
        );
        if (guide === undefined) {
          return `${target.label} has no guide yet`;
        }
        const names = new Map(
          target.commits.map((commit) => [commit.commitId, short(commit)]),
        );
        return JSON.stringify(
          {
            ideas: guide.ideas.map(({ commitId, ...idea }) => ({
              ...idea,
              commit: names.get(commitId) ?? commitId,
            })),
            links: guide.links,
          },
          null,
          2,
        );
      },
    }),
  ];
}
// ~/~ end
