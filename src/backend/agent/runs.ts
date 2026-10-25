// ~/~ begin <<docs/architecture/backend/runs.md#backend-agent-runs>>[init]
import { rm } from "node:fs/promises";
import * as z from "zod";
import {
  lineRuns,
  type Ran,
  type Run,
  type RunSide,
  type RunStep,
} from "../../frontend/model/runs";
import type { PlayedStep } from "../evidence/playRun";
import { Recipe, Step } from "../evidence/recipe";
import type { Recorder } from "../evidence/recorder";
import type { Played } from "../evidence/recordRun";
import type { EvidenceStore } from "../evidence/store";
import type { RepoContext } from "../repo/repos";
import { type Tool, ToolError, tool } from "./mcp";
import {
  commitNamed,
  liveSources,
  type SeriesSources,
  short,
  Target,
  targetOf,
} from "./series";

const Labelled = z.intersection(
  Step,
  z.object({
    label: z
      .string()
      .min(1)
      .optional()
      .describe("what the step is, for the reader: Turn the dark theme on"),
  }),
);

const Planned = Recipe.extend({
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug, the same in every version that runs the same thing",
    ),
  name: z.string().min(1).describe("what it does: Turning the theme on"),
  state: z.array(z.string()).default([]),
  about: z.string().default("").describe("what to look for, a sentence"),
  steps: z.array(Labelled).default([]),
});

export function runTools(
  store: EvidenceStore,
  recorder: Recorder,
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "record_runs",
      description:
        "Play recipes against the app at a commit and at its parent, and attach each as a run: per step, a picture of the window, the requests the page made, what it wrote to the console, and the lines of the repository it ran. Serve each side yourself, each on its own port. Use it for a change whose effect is in what the app does: a request, an error, which code runs.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id, or a prefix"),
        after: z
          .string()
          .url()
          .describe("where the app is served at the commit"),
        before: z
          .string()
          .url()
          .optional()
          .describe("where it is served at the commit's parent, if it can be"),
        runs: z.array(Planned).min(1),
      }),
      call: async (input, { repo, link, now }) => {
        const sources = sourcesOf(repo);
        const target = await targetOf(sources, input);
        const commit = commitNamed(target, input.commit);
        const afterFiles = new Set(await sources.files(commit.commitId));
        const beforeFiles = new Set(
          input.before === undefined
            ? []
            : await sources.files(`${commit.commitId}^`),
        );
        const lines: string[] = [link(target.path)];
        for (const planned of input.runs) {
          const after = await recorder.run(input.after, planned);
          const before =
            input.before === undefined
              ? null
              : await recorder.run(input.before, planned);
          try {
            if (after.stopped !== null) {
              throw new ToolError(
                `${planned.id} did not play at the commit: ${after.stopped}`,
              );
            }
            const run: Run = {
              series: target.series,
              version: target.version,
              commitId: commit.commitId,
              id: planned.id,
              name: planned.name,
              state: planned.state,
              about: planned.about,
              before:
                before === null
                  ? null
                  : await stored(store, before, beforeFiles),
              after: await stored(store, after, afterFiles),
              recordedAt: now().toISOString(),
            };
            repo.store.apply({ kind: "record-run", run });
            const ran = new Set(
              run.after.steps.flatMap((step) => step.ran.map((r) => r.path)),
            );
            lines.push(
              `${planned.id} is attached to ${short(commit)} in ${target.label}: ${run.after.steps.length} steps, ${run.after.steps.reduce((sum, step) => sum + step.requests.length, 0)} requests, ran lines in ${ran.size === 0 ? "no file of the repository" : [...ran].join(", ")}${before?.stopped ? `\nthe parent stopped at ${before.stopped}` : ""}`,
            );
          } finally {
            for (const played of [after, before]) {
              if (played !== null) {
                await rm(played.dir, { recursive: true, force: true });
              }
            }
          }
        }
        return lines.join("\n");
      },
    }),
  ];
}

async function stored(
  store: EvidenceStore,
  played: Played,
  files: Set<string>,
): Promise<RunSide> {
  const steps: RunStep[] = [];
  for (const step of againstFiles(played.steps, files)) {
    const put = await store.put(step.shot);
    if ("refused" in put) throw new ToolError(put.refused);
    steps.push({ ...step, shot: put.name });
  }
  return { steps, stopped: played.stopped };
}

/** `steps` with each name they ran under turned into a file of `files`,
 *  and the names that are none left out. */
export function againstFiles(
  steps: PlayedStep[],
  files: Set<string>,
): PlayedStep[] {
  const folder = servedFrom(
    steps.flatMap((step) => step.ran.map((ran) => ran.path)),
    files,
  );
  const fileOf = (path: string): string | null => {
    if (!path.startsWith("/")) return files.has(path) ? path : null;
    if (folder === null || !path.startsWith(folder)) return null;
    const file = path.slice(folder.length);
    return files.has(file) ? file : null;
  };
  return steps.map((step) => {
    const lines = new Map<string, number[]>();
    for (const ran of step.ran) {
      const file = fileOf(ran.path);
      if (file === null) continue;
      const numbers = lines.get(file) ?? [];
      for (const [from, to] of ran.lines) {
        for (let line = from; line <= to; line++) numbers.push(line);
      }
      lines.set(file, numbers);
    }
    const ran: Ran[] = [...lines]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, numbers]) => ({ path, lines: lineRuns(numbers) }));
    return { ...step, ran };
  });
}

/** The folder, ending in `/`, that most of the paths on disk sit in when
 *  read as `files`, or null when none does. */
function servedFrom(paths: string[], files: Set<string>): string | null {
  const votes = new Map<string, number>();
  for (const path of new Set(paths)) {
    if (!path.startsWith("/")) continue;
    for (
      let at = path.indexOf("/");
      at !== -1;
      at = path.indexOf("/", at + 1)
    ) {
      if (files.has(path.slice(at + 1))) {
        const folder = path.slice(0, at + 1);
        votes.set(folder, (votes.get(folder) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  for (const [folder, count] of votes) {
    if (best === null || count > (votes.get(best) ?? 0)) best = folder;
  }
  return best;
}
// ~/~ end
